/**
 * CdpLoginOrchestrator — runtime login orchestration against the user's real Chrome.
 *
 * Unlike inAppLoginService's blind polling loop, this orchestrator:
 *   1. TRACKS each login by a client-supplied requestId, correlating the login
 *      request ↔ the tab opened inside the user's real Chrome profile.
 *   2. INJECTS an in-page hook (via addInitScript + exposeFunction) so login
 *      completion is decided from page-side signals (URL pattern, storage keys,
 *      DOM mutations, non-HttpOnly cookies) instead of opaque Node-side polling.
 *   3. VERIFIES the captured session by opening a SEPARATE tab in the same
 *      profile context and confirming the provider accepts the cookies.
 *   4. CLEANS UP selectively: closes only the login tab and verification tab,
 *      keeping the CDP-controlled Chrome alive so Pillar 3 (execution binding)
 *      can reuse the same browser instance.
 *
 * This service is LOCAL-ONLY. Routes that use it must be classified with
 * isLocalOnlyPath() and all CDP endpoints are bound to 127.0.0.1.
 */

import { EventEmitter } from "events";
import type { Browser, BrowserContext, Page } from "playwright";

import { attachOrLaunch, getDefaultContext } from "./cdpController";
import type { TokenExtractionConfig } from "./tokenExtractionConfig";

// ─── Types ──────────────────────────────────────────────────────────────────

export type CdpLoginStatus =
  | "starting"
  | "navigating"
  | "detecting"
  | "verifying"
  | "complete"
  | "error"
  | "cancelled";

export interface CdpLoginSession {
  /** Client-supplied id correlating this login request ↔ the opened tab. */
  requestId: string;
  providerId: string;
  profileDir?: string;
  status: CdpLoginStatus;
  url?: string;
  startedAt: number;
  updatedAt: number;
  error?: string;
  credentials?: Record<string, string>;
  verified?: boolean;
}

export interface StartLoginOptions {
  requestId: string;
  providerId: string;
  config: TokenExtractionConfig;
  profileDir?: string;
  endpointUrl?: string;
  timeoutMs?: number;
  /** Set false to skip the separate-tab post-login verification. */
  verify?: boolean;
}

interface ActiveLogin {
  requestId: string;
  providerId: string;
  profileDir?: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  startedAt: number;
  aborted: boolean;
}

interface HookConfig {
  successUrlPattern?: string;
  tokenKeys: string[];
  cookieNames: string[];
  signalName: string;
}

/** In-page hook. Runs inside the provider tab; calls window[signalName] when a
 * login-complete signal is observed. Installed once per page via addInitScript. */
function loginHook(cfg: HookConfig): void {
  const win = window as unknown as Record<string, unknown>;
  if (win.__omniRouteHookInstalled) return;
  (win as Record<string, unknown>).__omniRouteHookInstalled = true;

  const emit = (info: { source: string; url: string }): void => {
    const fn = win[cfg.signalName];
    if (typeof fn === "function") (fn as (i: unknown) => void)(info);
  };

  const check = (): void => {
    try {
      const url = window.location.href;
      if (cfg.successUrlPattern && new RegExp(cfg.successUrlPattern).test(url)) {
        emit({ source: "url", url });
        return;
      }
      for (const key of cfg.tokenKeys) {
        if (window.localStorage.getItem(key) || window.sessionStorage.getItem(key)) {
          emit({ source: "storage", url });
          return;
        }
      }
      for (const name of cfg.cookieNames) {
        const found = document.cookie
          .split(";")
          .some((c) => c.trim().startsWith(`${name}=`));
        if (found) {
          emit({ source: "cookie", url });
          return;
        }
      }
    } catch {
      /* page may be mid-navigation */
    }
  };

  if (typeof MutationObserver !== "undefined" && document.documentElement) {
    new MutationObserver(check).observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });
  }
  window.setInterval(check, 800);
  check();
}

// ─── Orchestrator ────────────────────────────────────────────────────────────

class CdpLoginOrchestrator extends EventEmitter {
  /** Runtime registry: requestId ↔ session state. This is the tab↔request map. */
  private readonly sessions = new Map<string, CdpLoginSession>();
  private readonly active = new Map<string, ActiveLogin>();

  /** Start a CDP login flow. Resolves with captured credentials on success. */
  async startLogin(opts: StartLoginOptions): Promise<{
    success: boolean;
    sessionId: string;
    credentials?: Record<string, string>;
    error?: string;
    verified?: boolean;
  }> {
    const { requestId, providerId, config } = opts;

    if (this.active.has(requestId)) {
      this.upsert(requestId, {
        status: "error",
        error: `A login is already active for request "${requestId}"`,
      });
      return { success: false, sessionId: requestId, error: "Login already active" };
    }

    this.upsert(requestId, { providerId, profileDir: opts.profileDir, status: "starting" });

    let browser: Browser;
    let context: BrowserContext;
    try {
      browser = await attachOrLaunch({
        profileDir: opts.profileDir,
        endpointUrl: opts.endpointUrl,
      });
      context = getDefaultContext(browser);
      if (!context) {
        throw new Error("Chrome exposed no default (profile-persistent) context");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fail(requestId, message);
      return { success: false, sessionId: requestId, error: message };
    }

    const startedAt = Date.now();
    const active: ActiveLogin = {
      requestId,
      providerId,
      profileDir: opts.profileDir,
      browser,
      context,
      page: null as unknown as Page,
      startedAt,
      aborted: false,
    };

    try {
      const page = await context.newPage();
      active.page = page;
      this.active.set(requestId, active);
      this.upsert(requestId, {
        providerId,
        profileDir: opts.profileDir,
        status: "navigating",
        url: config.loginUrl,
      });

      // Capture configured request headers (e.g. bearer user-token style creds).
      const credentials: Record<string, string> = {};
      page.on("request", (request: { allHeaders(): Promise<Record<string, string>> }) => {
        void request
          .allHeaders()
          .then((headers) => captureConfiguredHeaders(config.tokenSources, headers, credentials))
          .catch(() => {
            /* some browser-internal requests expose no headers */
          });
      });

      // ── Inject the in-page hook (decide completion from page signals) ──
      const signalName = `__omniRouteLoginSignal_${requestId.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const hookCfg: HookConfig = {
        successUrlPattern: config.successUrlPattern?.source,
        tokenKeys: config.tokenSources
          .filter((s) => s.type === "localStorage" || s.type === "sessionStorage")
          .map((s) => (s.type === "localStorage" ? s.key : s.key)),
        cookieNames: config.tokenSources
          .filter((s) => s.type === "cookie")
          .map((s) => s.name),
        signalName,
      };
      const hookSignal = new Promise<{ source: string; url: string }>((resolve) => {
        void page.exposeFunction(signalName, (info: { source: string; url: string }) =>
          resolve(info)
        );
        void page.addInitScript(loginHook, hookCfg);
      });

      this.upsert(requestId, { status: "detecting" });
      this.emit("status", { requestId, providerId, status: "detecting", message: "Detecting login…" });

      await page.goto(config.loginUrl, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      // ── Wait for detection (hook-driven, with cookie poll as authoritative) ──
      const maxTimeout = opts.timeoutMs ?? config.pollingConfig.timeout ?? 300_000;
      const requiredCookieNames = hookCfg.cookieNames;
      const deadline = Date.now() + maxTimeout;

      const signalOrTimeout = new Promise<{ source: string; url: string } | null>((resolve) => {
        let settled = false;
        const done = (v: { source: string; url: string } | null): void => {
          if (!settled) {
            settled = true;
            clearInterval(poll);
            resolve(v);
          }
        };

        const poll = setInterval(async () => {
          if (Date.now() > deadline) {
            done(null);
            return;
          }
          // Authoritative HttpOnly-aware cookie check.
          try {
            const cookies = await context.cookies(config.homeUrl || undefined);
            const ok = requiredCookieNames.every((name) =>
              cookies.some((c) => c.name === name && c.value)
            );
            if (ok) done({ source: "cookie-poll", url: page.url() });
          } catch {
            /* context may be navigating */
          }
        }, 1000);

        void hookSignal.then(async (info) => {
          let cookiesOk = requiredCookieNames.length === 0;
          if (!cookiesOk) {
            try {
              const cookies = await context.cookies(config.homeUrl || undefined);
              cookiesOk = requiredCookieNames.every((c) =>
                cookies.some((x) => x.name === c && x.value)
              );
            } catch {
              cookiesOk = false;
            }
          }
          done(info && cookiesOk ? info : null);
        });
      });

      const signal = await signalOrTimeout;
      if (!signal) {
        this.fail(requestId, "Login timed out");
        return { success: false, sessionId: requestId, error: "Login timed out" };
      }

      // ── Extract credentials (authoritative read from the default context) ──
      const allCookies = await context.cookies().catch(() => [] as Array<{ name: string; value: string; domain: string }>);
      for (const source of config.tokenSources) {
        if (source.type === "cookie") {
          const domain = source.domain || undefined;
          const matched = allCookies.find(
            (c) =>
              c.name === source.name &&
              (!domain || c.domain.includes(domain.replace(/^\./, "")))
          );
          if (matched && !credentials[source.name]) credentials[source.name] = matched.value;
        } else if (source.type === "localStorage" || source.type === "sessionStorage") {
          const storage = source.type === "localStorage" ? "localStorage" : "sessionStorage";
          try {
            const value = await page.evaluate(
              (args: { storage: string; key: string }) =>
                window[args.storage as "localStorage" | "sessionStorage"].getItem(args.key),
              { storage, key: source.key }
            );
            if (value && typeof value === "string") credentials[source.key] = value;
          } catch {
            /* storage access may fail on some domains */
          }
        }
      }
      if (allCookies.length) credentials.cookies = JSON.stringify(allCookies);
      if (opts.profileDir) credentials.profileDir = opts.profileDir;

      const requiredKeys = config.tokenSources.map((s) =>
        s.type === "cookie" ? s.name : s.type === "localStorage" || s.type === "sessionStorage" ? s.key : s.name
      );
      const allFound = requiredKeys.every((k) => credentials[k] !== undefined);
      if (!allFound || Object.keys(credentials).length === 0) {
        this.fail(requestId, "Signal detected but required credentials were not captured");
        return { success: false, sessionId: requestId, error: "Credential capture incomplete" };
      }

      // ── Post-login verification in a SEPARATE tab (same profile context) ──
      let verified = true;
      if (opts.verify !== false && config.homeUrl) {
        this.upsert(requestId, { status: "verifying" });
        this.emit("status", { requestId, providerId, status: "verifying", message: "Verifying session…" });
        const verifyPage = await context.newPage();
        try {
          const probe = await verifyPage.goto(config.homeUrl, {
            waitUntil: "domcontentloaded",
            timeout: 20_000,
          });
          const finalUrl = verifyPage.url();
          // A redirect back to a login page usually means the session is not accepted.
          const looksLoggedIn =
            !!probe &&
            !/login|signin|auth|logout/i.test(finalUrl) &&
            (probe.status() < 400 || probe.status() === 0);
          verified = looksLoggedIn;
        } catch {
          verified = false;
        } finally {
          // Selective cleanup: close only the verification tab.
          await verifyPage.close().catch(() => undefined);
        }
        this.upsert(requestId, { verified });
      }

      this.upsert(requestId, {
        status: "complete",
        credentials,
        verified,
      });
      this.emit("status", { requestId, providerId, status: "complete", message: "Login complete" });

      // Selective cleanup: close the login tab, KEEP the CDP Chrome alive.
      await page.close().catch(() => undefined);
      this.active.delete(requestId);

      return { success: true, sessionId: requestId, credentials, verified };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.fail(requestId, message);
      this.active.delete(requestId);
      return { success: false, sessionId: requestId, error: message };
    }
  }

  /** Look up a session by requestId. */
  getSession(requestId: string): CdpLoginSession | undefined {
    return this.sessions.get(requestId);
  }

  /** All tracked sessions (for a dashboard status endpoint). */
  listSessions(): CdpLoginSession[] {
    return [...this.sessions.values()];
  }

  /** Cancel an in-flight login (marks aborted; CDP Chrome stays alive). */
  async cancel(requestId: string): Promise<boolean> {
    const active = this.active.get(requestId);
    if (active) {
      active.aborted = true;
      await active.page.close().catch(() => undefined);
      this.active.delete(requestId);
      this.upsert(requestId, { status: "cancelled" });
      return true;
    }
    return false;
  }

  /** Close a session's tab. Optionally also close the CDP Chrome for the profile. */
  async closeSession(
    requestId: string,
    opts?: { closeChrome?: boolean }
  ): Promise<boolean> {
    const session = this.sessions.get(requestId);
    if (!session) return false;

    const active = this.active.get(requestId);
    if (active) {
      await active.page.close().catch(() => undefined);
      this.active.delete(requestId);
      if (opts?.closeChrome) {
        await active.browser.close().catch(() => undefined);
      }
    }
    this.sessions.delete(requestId);
    return true;
  }

  private upsert(
    requestId: string,
    patch: Partial<CdpLoginSession>
  ): void {
    const now = Date.now();
    const prev = this.sessions.get(requestId);
    this.sessions.set(requestId, {
      requestId,
      providerId: patch.providerId ?? prev?.providerId ?? "unknown",
      profileDir: patch.profileDir ?? prev?.profileDir,
      status: patch.status ?? prev?.status ?? "starting",
      url: patch.url ?? prev?.url,
      startedAt: patch.startedAt ?? prev?.startedAt ?? now,
      updatedAt: now,
      error: patch.error ?? prev?.error,
      credentials: patch.credentials ?? prev?.credentials,
      verified: patch.verified ?? prev?.verified,
    });
  }

  private fail(requestId: string, error: string): void {
    this.upsert(requestId, { status: "error", error });
    this.emit("status", { requestId, providerId: this.sessions.get(requestId)?.providerId, status: "error", message: error });
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Capture explicitly-configured header credentials (never the first token). */
function captureConfiguredHeaders(
  tokenSources: TokenExtractionConfig["tokenSources"],
  headers: Record<string, string>,
  out: Record<string, string>
): void {
  for (const source of tokenSources) {
    if (source.type !== "header") continue;
    const name = source.name.toLowerCase();
    const value = headers[name];
    if (value && !out[source.name]) {
      out[source.name] = value;
    }
  }
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const cdpLoginOrchestrator = new CdpLoginOrchestrator();