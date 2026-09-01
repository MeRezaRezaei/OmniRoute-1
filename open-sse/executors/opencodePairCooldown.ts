/**
 * Per-(egress, account, model) cooldown store for noauth executors that
 * round-robin across several "accounts" (fingerprints), each bound to an
 * egress (a configured proxy, or direct).
 *
 * WHY this exists — the whole point is granularity + honoring the upstream.
 *
 * 1. GRANULARITY. The established generic cooldown is scoped to a whole
 *    connection (markAccountUnavailable / applyEgressIpLockout cools the
 *    connection and every sibling sharing the same egress IP). That is too
 *    coarse for the opencode free tier: its quota is bucketed by
 *    (egress IP × account × model), so a 429 on one (account, proxy, model)
 *    must NOT take down the other accounts/proxies that still have quota.
 *    This store keys the cooldown on the tuple (egress, accountId, model),
 *    so the rotation can keep trying the OTHER pairs (different proxy /
 *    different account / different model) while the one that actually
 *    exhausted remains cooled.
 *
 *    - `egress` = a stable label for the egress path: `direct` for the
 *      anonymous no-proxy account, or `type://host:port` for a configured
 *      proxy. Two accounts bound to the SAME proxy share that egress (they
 *      present the same IP) and therefore share the IP-bucketed budget —
 *      that is why the key cannot be just the account id.
 *    - `accountId` = the fingerprint (or API-key id for the zen tier).
 *    - `model` = the model that produced the 429 (per-model quota).
 *
 * 2. ACCOUNT/IP-WIDE VERSUS MODEL-SCOPED. Some 429s are model-specific (only
 *    "grok-4.5-high" is exhausted on this pair); others mean the whole
 *    (account, IP) budget is gone ("monthly usage limit reached",
 *    `x-ratelimit-remaining-requests: 0`, `organization_quota_exceeded`,
 *    `plan_limit_reached`). `markFamily` cools every model on a pair; a plain
 *    `markPair` cools just that one model, so sibling models on the same
 *    account/proxy stay live.
 *
 * 3. HONOR THE UPSTREAM AMOUNT. Instead of "as long as the app wants", the
 *    cooldown is bound to what the upstream actually says — the `Retry-After`
 *    header, the `X-RateLimit-Reset` header, or the body's `Resets in N
 *    days/hours/...` — so we do not retry before the IP/account quota renews
 *    (wasted calls) nor wait longer than the API says (unnecessary downtime).
 *    `parseUpstreamCooldown` returns the authoritative duration and whether
 *    it is account/IP-wide.
 *
 * State is process-local (the executors are process singletons, so this
 * survives across requests; it is intentionally NOT persisted to SQLite —
 * cooldown granularity is a per-process runtime concern, and DB writes on the
 * hot path are exactly what applyEgressIpLockout was found to over-do).
 */

type ProxyLike = {
  type?: string;
  host?: string;
  port?: number;
} | null;

/** Stable egress label used as the first dimension of the cooldown key. */
export function buildEgressKey(proxy: ProxyLike): string {
  if (!proxy || !proxy.host) return "direct";
  return `${proxy.type || "http"}://${proxy.host}:${proxy.port ?? 0}`;
}

/** Per-model cooldown key: egress + account + model. */
export function buildPairKey(egress: string, accountId: string, model: string): string {
  return `m:${egress}` + `|a:${accountId}` + `|model:${model}`;
}

/** Account/IP-wide (all models) cooldown key for one (egress, account).
 * Uses a `model:*` sentinel that cannot collide with a literal pair key for a
 * model actually named `*` (the pair key would be `model:*`, the family key
 * `model:*:*`). */
export function buildFamilyKey(egress: string, accountId: string): string {
  return `m:${egress}` + `|a:${accountId}` + `|model:*:*`;
}

export interface PairCooldownEntry {
  cooldownUntil: number;
  consecutiveFails: number;
  reason: string;
}

export class OpenCodePairCooldownStore {
  private model = new Map<string, PairCooldownEntry>();
  private family = new Map<string, PairCooldownEntry>();

  /** In-memory only; callers pass their own durable store if needed. */

  isFamilyCooled(egress: string, accountId: string, now = Date.now()): boolean {
    return this.getReadyUntil(this.family, buildFamilyKey(egress, accountId), now) > now;
  }

  isPairCooled(egress: string, accountId: string, model: string, now = Date.now()): boolean {
    if (this.isFamilyCooled(egress, accountId, now)) return true;
    return this.getReadyUntil(this.model, buildPairKey(egress, accountId, model), now) > now;
  }

  getPairCooledUntil(egress: string, accountId: string, model: string): number {
    const fam = this.family.get(buildFamilyKey(egress, accountId));
    const ml = this.model.get(buildPairKey(egress, accountId, model));
    return Math.max(fam?.cooldownUntil ?? 0, ml?.cooldownUntil ?? 0);
  }

  /**
   * Cool a single (pair, model). `cooldownMs` should come from the upstream
   * when available (see parseUpstreamCooldown), otherwise a caller-supplied
   * backoff. Rounds up to the larger of the given duration and the existing
   * entry so a shorter re-lock never shrinks an active cooldown, and extends
   * a per-model entry's consecutive failure count for observability. Mirrors
   * the "never shorten" rule from applyEgressIpLockout / recordModelLockout.
   */
  markPair(
    egress: string,
    accountId: string,
    model: string,
    cooldownMs: number,
    reason = "429",
    now = Date.now()
  ): PairCooldownEntry {
    const key = buildPairKey(egress, accountId, model);
    const existing = this.model.get(key);
    const cooldownUntil = Math.max(now + Math.max(cooldownMs, 0), existing?.cooldownUntil ?? 0);
    const consecutiveFails = (existing?.consecutiveFails ?? 0) + 1;
    const entry: PairCooldownEntry = { cooldownUntil, consecutiveFails, reason };
    this.model.set(key, entry);
    return entry;
  }

  /** Cool the whole (egress, account) — every model on it. Longer of the two. */
  markFamily(
    egress: string,
    accountId: string,
    cooldownMs: number,
    reason = "429",
    now = Date.now()
  ): PairCooldownEntry {
    const key = buildFamilyKey(egress, accountId);
    const existing = this.family.get(key);
    const cooldownUntil = Math.max(now + Math.max(cooldownMs, 0), existing?.cooldownUntil ?? 0);
    const consecutiveFails = (existing?.consecutiveFails ?? 0) + 1;
    const entry: PairCooldownEntry = { cooldownUntil, consecutiveFails, reason };
    this.family.set(key, entry);
    return entry;
  }

  /** Clear a successful pair's per-model cooldown (family stays until slow burn). */
  markSuccess(egress: string, accountId: string, model: string): void {
    this.model.delete(buildPairKey(egress, accountId, model));
  }

  /** Test/ops helper: forget a specific pair (e.g. after the operator changes a proxy). */
  resetPair(egress: string, accountId: string, model: string): void {
    this.model.delete(buildPairKey(egress, accountId, model));
  }

  resetFamily(egress: string, accountId: string): void {
    this.family.delete(buildFamilyKey(egress, accountId));
  }

  clear(): void {
    this.model.clear();
    this.family.clear();
  }

  get size(): number {
    return this.model.size + this.family.size;
  }

  private getReadyUntil(map: Map<string, PairCooldownEntry>, key: string, now: number): number {
    const entry = map.get(key);
    if (!entry) return 0;
    if (entry.cooldownUntil <= now) {
      map.delete(key);
      return 0;
    }
    return entry.cooldownUntil;
  }
}

/** Matters used to classify whether a 429 is account/IP-wide or model-scoped. */
export const ACCOUNT_WIDE_BODY_MARKERS = [
  "monthly usage limit reached",
  "organization_quota_exceeded",
  "account_quota_exceeded",
  "plan_limit_reached",
  "usage limit reached",
];

/** Whether a 429 body indicates the whole (account, IP) budget is exhausted. */
export function isAccountWideQuotaBody(text: string): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return ACCOUNT_WIDE_BODY_MARKERS.some((m) => lower.includes(m));
}

/** True when the response headers signal the whole account/IP is out of quota. */
export function isAccountWideQuotaHeaders(headers: Headers | null): boolean {
  if (!headers) return false;
  const remReq = headers.get("x-ratelimit-remaining-requests");
  const remTok = headers.get("x-ratelimit-remaining-tokens");
  return remReq === "0" || remTok === "0";
}

/**
 * Parse the authoritative upstream cooldown from a 429 response: `Retry-After`
 * (seconds or HTTP-date), `X-RateLimit-Reset` (epoch s or ms), or the body's
 * `Resets in N <unit>` / `reset after N<unit>` text. Never guesses a duration
 * when the upstream says nothing — returns null so the caller falls back to
 * its own backoff.
 */
export function parseUpstreamCooldownMs(headers: Headers | null, bodyText: string): number | null {
  let ms: number | null = null;

  if (headers) {
    const retryAfter = headers.get("retry-after");
    if (retryAfter) {
      const secs = Number.parseInt(retryAfter, 10);
      if (!Number.isNaN(secs) && String(secs) === retryAfter.trim()) {
        ms = secs * 1000;
      } else {
        const date = new Date(retryAfter);
        if (!Number.isNaN(date.getTime())) ms = Math.max(date.getTime() - Date.now(), 0);
      }
    }

    if (ms === null) {
      const reset = headers.get("x-ratelimit-reset");
      if (reset) {
        const ts = Number.parseInt(reset, 10);
        if (!Number.isNaN(ts)) ms = Math.max((ts > 10000000000 ? ts : ts * 1000) - Date.now(), 0);
      }
    }
  }

  if (ms === null && bodyText) {
    const resetRe = /resets?\s+in\s+(\d+)\s+(day|days|hour|hours|minute|minutes|second|seconds)\b/i;
    const m = bodyText.match(resetRe);
    if (m) {
      const n = Number(m[1]);
      switch (m[2].toLowerCase()) {
        case "day":
        case "days":
          ms = n * 86_400_000;
          break;
        case "hour":
        case "hours":
          ms = n * 3_600_000;
          break;
        case "minute":
        case "minutes":
          ms = n * 60_000;
          break;
        case "second":
        case "seconds":
          ms = n * 1000;
          break;
      }
    }
    if (ms === null) {
      const resetAfter =
        /(?:reset after|will reset after|resets? after)\s+(\d+h)?(\d+m)?(\d+s)?/i.exec(bodyText);
      if (resetAfter) {
        const h = resetAfter[1] ? Number.parseInt(resetAfter[1], 10) : 0;
        const m2 = resetAfter[2] ? Number.parseInt(resetAfter[2], 10) : 0;
        const s = resetAfter[3] ? Number.parseInt(resetAfter[3], 10) : 0;
        if (h || m2 || s) ms = (h * 3600 + m2 * 60 + s) * 1000;
      }
    }
  }

  if (ms !== null && ms > 0) return ms;
  return null;
}

/** Convenience: classify a 429 into a cooldown decision. */
export function classifyUpstream429(
  headers: Headers | null,
  bodyText: string
): { cooldownMs: number | null; accountWide: boolean } {
  const accountWide = isAccountWideQuotaHeaders(headers) || isAccountWideQuotaBody(bodyText);
  const cooldownMs = parseUpstreamCooldownMs(headers, bodyText);
  return { cooldownMs, accountWide };
}
