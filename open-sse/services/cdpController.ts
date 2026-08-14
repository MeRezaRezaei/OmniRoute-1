/**
 * CdpController — persistent, reconnectable CDP control of the user's real Chrome.
 *
 * Unlike the one-shot launchCdpBrowser() in chromeProfiles.ts (launch, log in,
 * close), this controller keeps a Chrome instance alive per user-data-dir and
 * reconnects it when it crashes. It is the single owner of the CDP browser for
 * a given profile and exposes:
 *   - getBrowser()  — attach to an already-running debuggable Chrome, or launch
 *                     one against the user's real profile dir.
 *   - getDefaultContext() — the PROFILE-persistent context (contexts()[0]),
 *                     NOT an isolated newContext(), so cookies write to disk.
 *   - openPage(url) — open a tab inside the user's real profile.
 *   - readCookies(urls) — live cookie read from the default context.
 *   - close()      — tear down only this controller's browser.
 *
 * All CDP ws endpoints are bound to 127.0.0.1 (loopback) only. This service is
 * LOCAL-ONLY; routes using it must be classified with isLocalOnlyPath().
 */

import { spawn, type ChildProcess } from "child_process";
import type { Browser, BrowserContext, Page } from "playwright";

import {
  getChromeUserDataDir,
  parseCdpEndpointFromStderr,
  resolveChromeBinary,
} from "./chromeProfiles";

interface CdpSession {
  browser: Browser;
  process?: ChildProcess;
  profileDir?: string;
  userDataDir: string;
  wsUrl: string;
  connectedAt: number;
}

const sessions = new Map<string, CdpSession>();
const CONNECT_TIMEOUT_MS = 15_000;

/** Attach to an existing debuggable Chrome endpoint or launch a fresh one. */
export async function attachOrLaunch(opts?: {
  profileDir?: string;
  userDataDir?: string;
  endpointUrl?: string;
  connectTimeoutMs?: number;
}): Promise<Browser> {
  const userDataDir = opts?.userDataDir ?? getChromeUserDataDir();
  const profileDir = opts?.profileDir ?? "Default";
  const key = profileKey(userDataDir, profileDir);

  const existing = sessions.get(key);
  if (existing?.browser.isConnected()) return existing.browser;

  let browser: Browser | null = null;

  // 1) Attach to an already-running debuggable Chrome for the same profile.
  if (opts?.endpointUrl) {
    browser = await connectEndpoint(opts.endpointUrl, opts.connectTimeoutMs);
  } else if (opts?.profileDir) {
    browser = await attachRunningChrome(opts.profileDir, userDataDir);
  }

  // 2) Otherwise launch Chrome against the real profile dir.
  if (!browser) {
    const launched = await launchProfile(opts);
    if (!launched) throw new Error("Chrome did not expose a CDP endpoint");
    sessions.set(key, {
      ...launched,
      profileDir,
      userDataDir,
      wsUrl: launched.wsUrl,
      connectedAt: Date.now(),
    });
    return sessions.get(key)!.browser;
  }

  sessions.set(key, {
    browser,
    profileDir,
    userDataDir,
    wsUrl: opts?.endpointUrl ?? "",
    connectedAt: Date.now(),
  });
  return browser;
}

function profileKey(userDataDir: string, profileDir: string): string {
  return `${userDataDir}::${profileDir}`;
}

async function connectEndpoint(
  wsUrl: string,
  timeoutMs?: number,
): Promise<Browser | null> {
  const { chromium } = await import("playwright");
  return chromium.connectOverCDP(wsUrl, {
    isLocal: true,
    noDefaults: true,
    timeout: timeoutMs ?? CONNECT_TIMEOUT_MS,
  });
}

/**
 * Try to attach to a Chrome already running with remote debugging on the default
 * loopback port 9222. Returns null if none is debuggable.
 */
async function attachRunningChrome(
  profileDir: string,
  userDataDir: string,
): Promise<Browser | null> {
  const probe = `http://127.0.0.1:9222/json/version`;
  try {
    const res = await fetch(probe, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const info = (await res.json()) as { webSocketDebuggerUrl?: string };
    if (!info.webSocketDebuggerUrl) return null;
    return connectEndpoint(info.webSocketDebuggerUrl, 5000);
  } catch {
    return null;
  }
}

async function launchProfile(opts?: {
  profileDir?: string;
  userDataDir?: string;
}): Promise<{ browser: Browser; process: ChildProcess; wsUrl: string } | null> {
  const bin = resolveChromeBinary();
  if (!bin) throw new Error("Chrome binary not found; cannot launch CDP browser");

  const userDataDir = opts?.userDataDir ?? getChromeUserDataDir();
  const args = [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (opts?.profileDir) args.push(`--profile-directory=${opts.profileDir}`);

  const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await waitForCdpEndpoint(child);
  if (!wsUrl) {
    child.kill("SIGTERM");
    return null;
  }
  const browser = await connectEndpoint(wsUrl, CONNECT_TIMEOUT_MS);
  if (!browser) {
    child.kill("SIGTERM");
    return null;
  }
  return { browser, process: child, wsUrl };
}

function waitForCdpEndpoint(
  child: ChildProcess,
  timeoutMs = CONNECT_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    let stderr = "";
    const timer = setTimeout(() => {
      cleanup();
      resolve(parseCdpEndpointFromStderr(stderr)?.wsUrl ?? null);
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      const found = parseCdpEndpointFromStderr(stderr);
      if (found) {
        cleanup();
        resolve(found.wsUrl);
      }
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.stderr?.off("data", onData);
    };
    child.stderr?.on("data", onData);
    child.on("error", () => {
      cleanup();
      resolve(null);
    });
  });
}

/**
 * Return the PROFILE-persistent default context (the one tied to the user's real
 * profile). This is what must be used for login tabs and cookie reads so writes
 * persist to disk. Never create a newContext() for a profile-backed session.
 */
export function getDefaultContext(browser: Browser): BrowserContext | null {
  return browser.contexts()[0] ?? null;
}

/** Open a new tab inside the given context and navigate to url. */
export async function openPage(
  context: BrowserContext,
  url: string,
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

/** Live cookie read for the profile from the default context. */
export async function readCookies(
  context: BrowserContext,
  urls: string[],
): Promise<Array<{ name: string; value: string; domain: string }>> {
  const cookies = await context.cookies(urls);
  return cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain }));
}

/** Tear down only this controller's browser for a profile. */
export async function close(opts: {
  profileDir?: string;
  userDataDir?: string;
}): Promise<void> {
  const userDataDir = opts.userDataDir ?? getChromeUserDataDir();
  const key = profileKey(userDataDir, opts.profileDir ?? "Default");
  const session = sessions.get(key);
  if (!session) return;
  sessions.delete(key);
  try {
    await session.browser.close();
  } catch {
    /* already gone */
  }
  session.process?.kill("SIGTERM");
}

/** Active CDP endpoints for external consumers (e.g. a dashboard polling route). */
export function listSessions(): Array<{
  profileDir: string;
  userDataDir: string;
  wsUrl: string;
  connectedAt: number;
}> {
  return [...sessions.values()].map((s) => ({
    profileDir: s.profileDir ?? "Default",
    userDataDir: s.userDataDir,
    wsUrl: s.wsUrl,
    connectedAt: s.connectedAt,
  }));
}