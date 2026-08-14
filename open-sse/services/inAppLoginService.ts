/**
 * InAppLoginService — Playwright-based web login for cookie providers
 *
 * Opens a Playwright browser context, navigates to the provider's login page,
 * and polls for target cookies/tokens after the user completes login.
 *
 * Used as the dashboard/web fallback path when Electron is not available.
 * For Electron-native login, see electron/loginManager.js.
 *
 * Events:
 *   "status" — { providerId: string, status: string, message: string }
 *     status values: starting, navigating, waiting, polling, complete, error, cancelled, cdp
  "cdp" fires once Chromium exposes its loopback DevTools endpoint
  (ws://127.0.0.1:PORT/devtools/browser/...); remote clients reach it via the
  authenticated server-side proxy route, never directly.
 */

import { EventEmitter } from "events";
import {
  TOKEN_EXTRACTION_CONFIGS,
  TokenExtractionConfig,
  type TokenSource,
} from "./tokenExtractionConfig";
import { isFeatureFlagEnabled } from "@/shared/utils/featureFlags";
import { launchCdpBrowser } from "./chromeProfiles";

// Active-login profile/flag context (set per startLogin call)
let _activeLoginProfileDir: string | undefined;
let _activeLoginForceCdp = false;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LoginResult {
  success: boolean;
  credentials?: Record<string, string>;
  error?: string;
}

interface ActiveLogin {
  providerId: string;
  aborted: boolean;
}

export function captureConfiguredHeaders(
  tokenSources: readonly TokenSource[],
  requestHeaders: Record<string, string>,
  credentials: Record<string, string>
): void {
  for (const source of tokenSources) {
    if (source.type !== "header" || credentials[source.name]) continue;
    const value = requestHeaders[source.name.toLowerCase()];
    if (typeof value === "string" && value.trim()) {
      credentials[source.name] = value.trim();
    }
  }
}

/**
 * Parse the CDP loopback endpoint Chromium prints to stderr after launch:
 *   "DevTools listening on ws://127.0.0.1:PORT/devtools/browser/<id>"
 * Returns the port + ws URL, or null if the line does not match.
 */
export function parseCdpEndpointFromStderr(
  text: string
): { port: number; wsUrl: string } | null {
  const m = text.match(
    /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/\S+)/
  );
  if (!m) return null;
  return { port: Number(m[2]), wsUrl: m[1] };
}

// ─── Service ────────────────────────────────────────────────────────────────

export class InAppLoginService extends EventEmitter {
  private activeLogin: ActiveLogin | null = null;
  private activeCdpEndpoints: Map<
    string,
    { port: number; wsUrl: string; startedAt: number }
  > = new Map();

  /**
   * Capture the CDP (Chrome DevTools Protocol) loopback endpoint that Chromium
   * prints to stderr after launch ("DevTools listening on ws://127.0.0.1:PORT/...").
   * The endpoint is bound to 127.0.0.1 only; remote clients must reach it through
   * the authenticated server-side proxy route, never directly.
   */
  private captureCdpEndpoint(
    browser: import("playwright").Browser,
    providerId: string
  ): void {
    const proc = (
      browser as unknown as {
        process(): import("child_process").ChildProcess | null;
      }
    ).process();
    if (!proc || !proc.stderr) return;
    const handler = (chunk: Buffer) => {
      const parsed = parseCdpEndpointFromStderr(chunk.toString());
      if (parsed) {
        this.activeCdpEndpoints.set(providerId, {
          ...parsed,
          startedAt: Date.now(),
        });
        this.emit(
          "status",
          providerId,
          "cdp",
          `CDP loopback ready on 127.0.0.1:${parsed.port}`
        );
        proc.stderr?.removeListener("data", handler);
      }
    };
    proc.stderr.on("data", handler);
  }

  /**
   * Return the active CDP loopback endpoint for a provider, if a browser login
   * is currently running with remote-debugging enabled. Used by the WS proxy
   * route that bridges a remote dashboard client to the server-local CDP socket.
   */
  getCdpEndpoint(
    providerId: string
  ): { port: number; wsUrl: string; startedAt: number } | undefined {
    return this.activeCdpEndpoints.get(providerId);
  }

  /**
   * Remove a provider's CDP endpoint (e.g. after login completes or browser closes).
   */
  clearCdpEndpoint(providerId: string): void {
    this.activeCdpEndpoints.delete(providerId);
  }

  /**
   * Start a login flow for a web-cookie provider using Playwright.
   * @param providerId - e.g. "claude-web", "chatgpt-web"
   * @param options.timeout - Total timeout in ms (default: config value or 300s)
   */
  async startLogin(providerId: string, options?: { timeout?: number; profileDir?: string; forceCdp?: boolean }): Promise<LoginResult> {
    const config = TOKEN_EXTRACTION_CONFIGS.get(providerId);
    if (!config) {
      this.emit("status", { providerId, status: "error", message: "No extraction config found" });
      return { success: false, error: `No extraction config for provider: ${providerId}` };
    }

    if (this.activeLogin) {
      this.emit("status", {
        providerId,
        status: "error",
        message: "A login is already in progress",
      });
      return { success: false, error: "A login process is already in progress" };
    }

    this.activeLogin = { providerId, aborted: false };
    this.emit("status", {
      providerId,
      status: "starting",
      message: `Opening ${config.displayName} login...`,
    });

    try {
      const result = await this.runBrowserLogin(config, options?.timeout, {
        profileDir: options?.profileDir,
        forceCdp: options?.forceCdp,
      });
      this.emit("status", {
        providerId,
        status: result.success ? "complete" : "error",
        message: result.success
          ? "Credentials extracted successfully"
          : result.error || "Login failed",
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("status", { providerId, status: "error", message });
      return { success: false, error: `Login failed: ${message}` };
    } finally {
      this.activeLogin = null;
    }
  }

  /**
   * Run the actual Playwright browser login flow
   */
  private async runBrowserLogin(
    config: TokenExtractionConfig,
    timeout?: number,
    cdp?: { profileDir?: string; forceCdp?: boolean }
  ): Promise<LoginResult> {
    const pollInterval = config.pollingConfig.pollInterval || 1000;
    const maxTimeout = timeout || config.pollingConfig.timeout || 300_000;
    const minLoginTime = config.pollingConfig.minLoginTime || 5000;
    const providerId = config.providerId;

    // Dynamically import Playwright (it's a heavy dep, only load when needed)
    let playwright: any;
    try {
      playwright = await import("playwright");
    } catch {
      return {
        success: false,
        error: "Playwright is not installed. Use Electron for native login.",
      };
    }

    if (this.activeLogin?.aborted) {
      return { success: false, error: "Login cancelled" };
    }

    // Launch browser
    this.emit("status", { providerId, status: "starting", message: "Launching browser..." });
      _activeLoginProfileDir = cdp?.profileDir;
    _activeLoginForceCdp = cdp?.forceCdp ?? false;
    const browser = await launchLoginBrowser(playwright.chromium, {
      headless: false, // User must interact login page
      args: [
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0", // auto-assign a free loopback port
      ],
    });

    // Capture CDP loopback endpoint (ws://127.0.0.1:PORT/devtools/browser/...) from Chromium stderr
    this.captureCdpEndpoint(browser, providerId);

    try {
      const cdpMode = (isFeatureFlagEnabled("WEB_LOGIN_FORCE_CDP") || _activeLoginForceCdp) && browser.contexts().length > 0;
      const context = cdpMode
        ? browser.contexts()[0]
        : await browser.newContext({
            viewport: { width: 1280, height: 800 },
            locale: "en-US",
          });
      const page = await context.newPage();
      const credentials: Record<string, string> = {};

      // Playwright normalizes request header names to lowercase. Capture only
      // explicitly configured credentials and never replace the first token
      // observed after login.
      page.on("request", (request: { allHeaders(): Promise<Record<string, string>> }) => {
        void request
          .allHeaders()
          .then((headers) => captureConfiguredHeaders(config.tokenSources, headers, credentials))
          .catch(() => {
            // Some browser-internal requests do not expose their full headers.
          });
      });

      // Navigate to login URL
      this.emit("status", {
        providerId,
        status: "navigating",
        message: `Loading ${config.loginUrl}`,
      });
      await page.goto(config.loginUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

      // Poll for success URL + token extraction
      const maxPolls = Math.floor(maxTimeout / pollInterval);
      const startTime = Date.now();

      for (let i = 0; i < maxPolls; i++) {
        if (this.activeLogin?.aborted) {
          this.emit("status", {
            providerId,
            status: "cancelled",
            message: "Login cancelled by user",
          });
          return { success: false, error: "Login cancelled" };
        }

        // Emit progress every 30 seconds
        if (i > 0 && i % 30 === 0) {
          this.emit("status", {
            providerId,
            status: "waiting",
            message: `Waiting for login... (${Math.round(i / 60)}m)`,
          });
        }

        // Wait before polling (respect minLoginTime on first iteration)
        if (Date.now() - startTime < minLoginTime) {
          await sleep(pollInterval);
          continue;
        }

        // Gather cookies from browser context
        const cookies = await context.cookies();
        const tokenSources = config.tokenSources;

        // Check cookie-based sources
        for (const source of tokenSources) {
          if (source.type === "cookie") {
            const domain = source.domain || undefined;
            const matched = cookies.find(
              (c: any) =>
                c.name === source.name && (!domain || c.domain.includes(domain.replace(/^\./, "")))
            );
            if (matched && !credentials[source.name]) {
              credentials[source.name] = matched.value;
            }
          }
        }

        // Check localStorage-based tokens
        for (const source of tokenSources) {
          if (source.type === "localStorage" && !credentials[source.key]) {
            try {
              const value = await page.evaluate(
                (key: string) => localStorage.getItem(key),
                source.key
              );
              if (value && typeof value === "string") {
                credentials[source.key] = value;
              }
            } catch {
              // localStorage access may fail on some domains
            }
          }
          if (source.type === "sessionStorage" && !credentials[source.key]) {
            try {
              const value = await page.evaluate(
                (key: string) => sessionStorage.getItem(key),
                source.key
              );
              if (value && typeof value === "string") {
                credentials[source.key] = value;
              }
            } catch {
              // sessionStorage access may fail on some domains
            }
          }
        }

        // Check if all required tokens are found
        const requiredKeys = tokenSources.map((s) =>
          s.type === "cookie"
            ? s.name
            : s.type === "localStorage" || s.type === "sessionStorage"
              ? s.key
              : s.name
        );
        const allFound = requiredKeys.every((k) => credentials[k] !== undefined);

        if (allFound && Object.keys(credentials).length > 0) {
            try {
    const __ctx = page.context();
    const __cookies = await __ctx.cookies().catch(() => [] as any[]);
    if (__cookies.length) credentials.cookies = JSON.stringify(__cookies);
  } catch { /* ignore cookie capture */ }
  if (_activeLoginProfileDir) credentials.profileDir = _activeLoginProfileDir;
  return { success: true, credentials };
        }

        // Check for success URL pattern
        if (config.successUrlPattern) {
          try {
            const currentUrl = page.url();
            if (config.successUrlPattern.test(currentUrl) && Object.keys(credentials).length > 0) {
                try {
    const __ctx = page.context();
    const __cookies = await __ctx.cookies().catch(() => [] as any[]);
    if (__cookies.length) credentials.cookies = JSON.stringify(__cookies);
  } catch { /* ignore cookie capture */ }
  if (_activeLoginProfileDir) credentials.profileDir = _activeLoginProfileDir;
  return { success: true, credentials };
            }
          } catch {
            // URL access may fail on some pages
          }
        }

        await sleep(pollInterval);
      }

      return { success: false, error: "Login timed out" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emit("status", { providerId, status: "error", message });
      return { success: false, error: `Login failed: ${message}` };
    } finally {
      const keepAlive =
        (isFeatureFlagEnabled("WEB_LOGIN_FORCE_CDP") || _activeLoginForceCdp) &&
        browser.contexts().length > 0;
      if (!keepAlive) await browser.close().catch(() => {});
    this.clearCdpEndpoint(providerId);
    }
  }

  /**
   * Cancel the current login flow
   */
  cancel(): void {
    if (this.activeLogin) {
      this.emit("status", {
        providerId: this.activeLogin.providerId,
        status: "cancelled",
        message: "Login cancelled by user",
      });
      this.activeLogin.aborted = true;
      this.activeLogin = null;
    }
  }

  /**
   * Get the active provider ID, if any
   */
  getActiveProvider(): string | null {
    return this.activeLogin?.providerId || null;
  }

  /**
   * Check if a login flow is in progress
   */
  isActive(): boolean {
    return this.activeLogin !== null && !this.activeLogin.aborted;
  }
}

// ─── Sleep helper ───────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Singleton ──────────────────────────────────────────────────────────────

export const inAppLoginService = new InAppLoginService();


//─── Flag-gated web-login browser launch ─────────────────────────────────────

/**
 * Launch the browser used for web-provider login.
 * When the WEB_LOGIN_FORCE_CDP feature flag is enabled, launch the user's real
 * Chrome in CDP mode (chromeProfiles.launchCdpBrowser); otherwise fall back to the
 * bundled Playwright launch (default behaviour).
 */
async function launchLoginBrowser(
  playwrightChromium: import("playwright").BrowserType,
  launchOptions: import("playwright").LaunchOptions,
): Promise<import("playwright").Browser> {
  if (isFeatureFlagEnabled("WEB_LOGIN_FORCE_CDP") || _activeLoginForceCdp) {
    return launchCdpBrowser({ profileDir: _activeLoginProfileDir });
  }
  return playwrightChromium.launch(launchOptions);
}
