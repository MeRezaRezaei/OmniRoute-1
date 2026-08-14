/**
 * CdpProfileScan — detect which web-provider session cookies a Chrome profile holds.
 *
 * Given a profileDir (+ optional userDataDir), attach-or-launch the user's real
 * Chrome via the CDP controller, read the PROFILE-persistent default context's
 * cookies, and report which registered web-provider token cookies are present.
 * This powers the dashboard profile→provider availability MATRIX (Pillar 4).
 *
 * LOCAL-ONLY. The browser is closed after the scan so no orphan Chrome remains
 * (unless the operator explicitly requests keepAlive for execution binding).
 */

import type { Browser } from "playwright";
import { attachOrLaunch, close, getDefaultContext } from "./cdpController";
import { listExtractionConfigs } from "./tokenExtractionConfig";

export interface CdpProviderMatch {
  providerId: string;
  displayName: string;
  /** Cookie token names from the provider's extraction config. */
  requiredCookies: string[];
  /** Which of requiredCookies were found in the profile. */
  foundCookies: string[];
  /** True when every required cookie name is present with a value. */
  available: boolean;
}

export interface CdpProfileScanResult {
  profileDir: string;
  userDataDir: string;
  /** Cookie domain → matched provider names, for context. */
  providers: CdpProviderMatch[];
  matchedProviderIds: string[];
  scannedAt: number;
  error?: string;
}

/** Build the expected cookie names per provider from extraction configs. */
function providerCookieRequirements(): Array<{
  providerId: string;
  displayName: string;
  cookieNames: string[];
}> {
  const out: Array<{ providerId: string; displayName: string; cookieNames: string[] }> = [];
  for (const config of listExtractionConfigs()) {
    const cookieNames = config.tokenSources
      .filter((s) => s.type === "cookie")
      .map((s) => s.name);
    if (cookieNames.length > 0) {
      out.push({ providerId: config.providerId, displayName: config.displayName, cookieNames });
    }
  }
  return out;
}

/**
 * Scan a single Chrome profile for web-provider session cookies.
 *
 * @param profileDir - Chrome profile directory name (e.g. "Default", "Profile 1").
 * @param userDataDir - Chrome user-data dir (defaults to the OS default).
 * @param keepAlive - keep the launched Chrome alive after scanning (for later
 *   execution binding). Default false → close after scan.
 */
export async function scanProfile(opts: {
  profileDir: string;
  userDataDir?: string;
  keepAlive?: boolean;
}): Promise<CdpProfileScanResult> {
  const userDataDir = opts.userDataDir;
  const result: CdpProfileScanResult = {
    profileDir: opts.profileDir,
    userDataDir: userDataDir ?? "",
    providers: [],
    matchedProviderIds: [],
    scannedAt: Date.now(),
  };

  let browser: Browser | null = null;
  try {
    browser = await attachOrLaunch({ profileDir: opts.profileDir, userDataDir });
    const context = getDefaultContext(browser);
    if (!context) throw new Error("Chrome exposed no default (profile-persistent) context");

    // Gather provider cookie-name expectations.
    const requirements = providerCookieRequirements();

    // Read cookies for every provider's home domain in one call when possible.
    // readCookies filters by URL; to be permissive we read all cookies once and
    // match by cookie name + optional domain ourselves.
    const allCookies = await context
      .cookies()
      .catch(() => [] as Array<{ name: string; value: string; domain: string }>);

    for (const req of requirements) {
      const foundCookies = req.cookieNames.filter((name) =>
        allCookies.some((c) => c.name === name && c.value)
      );
      const available = req.cookieNames.every((name) => foundCookies.includes(name));
      result.providers.push({
        providerId: req.providerId,
        displayName: req.displayName,
        requiredCookies: req.cookieNames,
        foundCookies,
        available,
      });
      if (available) result.matchedProviderIds.push(req.providerId);
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (!opts.keepAlive && browser) {
      await close({ profileDir: opts.profileDir, userDataDir }).catch(() => undefined);
    }
  }

  return result;
}

/**
 * Scan every detected Chrome profile for web-provider session cookies.
 * Returns one result per profile.
 */
export async function scanAllProfiles(opts?: {
  userDataDir?: string;
  keepAlive?: boolean;
}): Promise<CdpProfileScanResult[]> {
  const { listChromeProfiles } = await import("./chromeProfiles");
  const userDataDir = opts?.userDataDir;
  const profiles = listChromeProfiles(userDataDir);
  const results: CdpProfileScanResult[] = [];
  for (const profile of profiles) {
    results.push(
      await scanProfile({
        profileDir: profile.dir,
        userDataDir: userDataDir ?? profile.userDataDir,
        keepAlive: opts?.keepAlive,
      })
    );
  }
  return results;
}