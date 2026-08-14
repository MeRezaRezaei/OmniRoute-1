import fs from "fs";
import os from "os";
import path from "path";
import { spawn, type ChildProcess } from "child_process";
import type { Browser } from "playwright";

/** A Chrome user profile discovered on disk. */
export interface ChromeProfileInfo {
  /** Profile directory name under the User Data dir (e.g. "Default", "Profile 1"). */
  dir: string;
  /** Human display name (from Local State profile.info_cache). */
  name: string;
  /** Account email if discoverable from the profile Preferences. */
  email?: string;
  /** Parent Chrome "User Data" directory. */
  userDataDir: string;
}

/** Candidate Chrome/Chromium binaries, in priority order. */
const CHROME_BINARIES = [
  "google-chrome-stable",
  "google-chrome",
  "chromium",
  "chromium-browser",
  "chrome",
];

/** Resolve the first available Chrome/Chromium binary on PATH. */
export function resolveChromeBinary(): string | null {
  const paths = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  for (const bin of CHROME_BINARIES) {
    for (const dir of paths) {
      const candidate = path.join(dir, bin);
      if (safeIsFile(candidate)) return candidate;
      const exe = `${candidate}.exe`;
      if (safeIsFile(exe)) return exe;
    }
  }
  return null;
}

function safeIsFile(p: string): boolean {
  try {
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Chrome "User Data" directory per OS (override for tests / portability). */
export function getChromeUserDataDir(override?: string): string {
  if (override) return override;
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(
        home,
        "Library",
        "Application Support",
        "Google",
        "Chrome",
      );
    case "win32":
      return path.join(
        process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
        "Google",
        "Chrome",
        "User Data",
      );
    default:
      return path.join(home, ".config", "google-chrome");
  }
}

/**
 * Enumerate the user's Chrome profiles from Local State + per-profile Preferences.
 * Profile name usually maps to the signed-in account, so we also surface the email
 * when present. Returns [] if Chrome is not installed / Local State missing.
 */
export function listChromeProfiles(userDataDir?: string): ChromeProfileInfo[] {
  const base = getChromeUserDataDir(userDataDir);
  const localStatePath = path.join(base, "Local State");
  if (!safeIsFile(localStatePath)) return [];
  let localState: any;
  try {
    localState = JSON.parse(fs.readFileSync(localStatePath, "utf8"));
  } catch {
    return [];
  }
  const infoCache: Record<string, any> =
    localState?.profile?.info_cache ?? {};
  const out: ChromeProfileInfo[] = [];
  for (const [dir, info] of Object.entries<any>(infoCache)) {
    const name = typeof info?.name === "string" ? info.name : dir;
    let email: string | undefined;
    try {
      const prefsPath = path.join(base, dir, "Preferences");
      if (safeIsFile(prefsPath)) {
        const prefs = JSON.parse(fs.readFileSync(prefsPath, "utf8"));
        const acc =
          prefs?.account_info?.[0]?.email ??
          prefs?.account_cache?.[0]?.email ??
          prefs?.gaia_info?.email;
        if (typeof acc === "string") email = acc;
      }
    } catch {
      /* preferences unreadable -> skip email */
    }
    out.push({ dir, name, email, userDataDir: base });
  }
  return out;
}

/** Parse the loopback DevTools ws endpoint Chromium prints to stderr. */
export function parseCdpEndpointFromStderr(
  stderr: string,
): { port: number; wsUrl: string } | null {
  const m = stderr.match(
    /DevTools listening on (ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\/[A-Za-z0-9-]+)/,
  );
  if (!m) return null;
  return { port: Number(m[2]), wsUrl: m[1] };
}

/**
 * Launch the user's real Chrome with the DevTools remote-debugging endpoint enabled
 * and connect to it via Playwright (so the rest of the web-login flow is unchanged).
 * Avoids reading cookies from Chrome's encrypted SQLite — cookies are captured live
 * from the CDP session after login.
 */
export async function launchCdpBrowser(opts?: {
  profileDir?: string;
  userDataDir?: string;
}): Promise<Browser> {
  const bin = resolveChromeBinary();
  if (!bin) {
    throw new Error("Chrome binary not found; cannot launch CDP browser");
  }
  const userDataDir = opts?.userDataDir ?? getChromeUserDataDir();
  const args = [
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
  ];
  if (opts?.profileDir) args.push(`--profile-directory=${opts.profileDir}`);

  const child = spawn(bin, args, {
    stdio: ["ignore", "ignore", "pipe"],
  });

  const wsUrl = await waitForCdpEndpoint(child);
  if (!wsUrl) {
    child.kill("SIGTERM");
    throw new Error("Chrome did not expose a CDP endpoint");
  }
  const { chromium } = await import("playwright");
  const browser = await chromium.connectOverCDP(wsUrl);
  return browser;
}

function waitForCdpEndpoint(
  child: ChildProcess,
  timeoutMs = 15000,
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
