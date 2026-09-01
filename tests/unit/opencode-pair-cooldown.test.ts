import { describe, it } from "node:test";
import assert from "node:assert";
import {
  buildEgressKey,
  buildPairKey,
  buildFamilyKey,
  OpenCodePairCooldownStore,
  parseUpstreamCooldownMs,
  isAccountWideQuotaBody,
  isAccountWideQuotaHeaders,
  classifyUpstream429,
} from "../../open-sse/executors/opencodePairCooldown.ts";

describe("opencodePairCooldown: egress key", () => {
  it("labels the direct (no proxy) path 'direct'", () => {
    assert.strictEqual(buildEgressKey(null), "direct");
    assert.strictEqual(buildEgressKey(undefined), "direct");
    assert.strictEqual(buildEgressKey({}), "direct");
  });

  it("labels a configured proxy as type://host:port", () => {
    assert.strictEqual(
      buildEgressKey({ type: "http", host: "127.0.0.1", port: 8080 }),
      "http://127.0.0.1:8080"
    );
    assert.strictEqual(buildEgressKey({ host: "warp.server" }), "http://warp.server:0");
  });

  it("produces distinct keys for distinct proxies (even the same account)", () => {
    const a = buildEgressKey({ type: "http", host: "a.example", port: 9 });
    const b = buildEgressKey({ type: "http", host: "b.example", port: 9 });
    assert.notStrictEqual(a, b);
  });
});

describe("opencodePairCooldown: key composition", () => {
  it("pair key = egress|account|model", () => {
    assert.strictEqual(
      buildPairKey("direct", "fpA", "big-pickle"),
      "m:direct|a:fpA|model:big-pickle"
    );
  });
  it("family key cools all models on a pair", () => {
    assert.strictEqual(buildFamilyKey("direct", "fpA"), "m:direct|a:fpA|model:*:*");
  });
  it("model and family keys are distinct, even for a model literally named '*'", () => {
    assert.notStrictEqual(buildPairKey("direct", "fpA", "*"), buildFamilyKey("direct", "fpA"));
  });
});

describe("OpenCodePairCooldownStore", () => {
  it("isPairCooled is false by default", () => {
    const s = new OpenCodePairCooldownStore();
    assert.strictEqual(s.isPairCooled("direct", "fpA", "big-pickle"), false);
  });

  it("isPairCooled becomes true for the exact (egress,account,model) after markPair", () => {
    const s = new OpenCodePairCooldownStore();
    const now = 1_000_000;
    s.markPair("direct", "fpA", "big-pickle", 60_000, "429", now);
    assert.strictEqual(s.isPairCooled("direct", "fpA", "big-pickle", now + 1000), true);
    // Model granularity: a DIFFERENT model on the SAME pair is still live.
    assert.strictEqual(s.isPairCooled("direct", "fpA", "hy3-free", now + 1000), false);
    // Account granularity: a DIFFERENT account on the SAME egress is still live.
    assert.strictEqual(s.isPairCooled("direct", "fpB", "big-pickle", now + 1000), false);
    // Egress granularity: a DIFFERENT egress (proxy) for the SAME account is still live —
    // this is the core "try another proxy in the list" behavior.
    assert.strictEqual(
      s.isPairCooled("http://other.example:8080", "fpA", "big-pickle", now + 1000),
      false
    );
  });

  it("markPair 'never shortens' an existing, longer cooldown", () => {
    const s = new OpenCodePairCooldownStore();
    const now = 1_000_000;
    s.markPair("direct", "fpA", "big-pickle", 300_000, "429", now);
    s.markPair("direct", "fpA", "big-pickle", 10_000, "429", now + 1000);
    assert.strictEqual(s.getPairCooledUntil("direct", "fpA", "big-pickle"), now + 300_000);
  });

  it("markFamily cools every model on the pair but not other pairs", () => {
    const s = new OpenCodePairCooldownStore();
    const now = 1_000_000;
    s.markFamily("direct", "fpA", 300_000, "429", now);
    assert.strictEqual(s.isPairCooled("direct", "fpA", "big-pickle", now + 1000), true);
    assert.strictEqual(s.isPairCooled("direct", "fpA", "hy3-free", now + 1000), true);
    assert.strictEqual(s.isPairCooled("direct", "fpB", "big-pickle", now + 1000), false);
  });

  it("family cooldown is authoritative even if a model has no own cooldown", () => {
    const s = new OpenCodePairCooldownStore();
    const now = 1_000_000;
    s.markFamily("direct", "fpA", 300_000, "quota_exhausted", now);
    assert.strictEqual(s.getPairCooledUntil("direct", "fpA", "any-model"), now + 300_000);
  });

  it("expired cooldown self-cleans and reports not-cooled", () => {
    const s = new OpenCodePairCooldownStore();
    const now = 1_000_000;
    s.markPair("direct", "fpA", "big-pickle", 60_000, "429", now);
    assert.strictEqual(s.isPairCooled("direct", "fpA", "big-pickle", now + 61_000), false);
    assert.strictEqual(s.size, 0, "expired entry is evicted on read");
  });

  it("markSuccess clears only that pair's model cooldown", () => {
    const s = new OpenCodePairCooldownStore();
    const now = 1_000_000;
    s.markPair("direct", "fpA", "big-pickle", 300_000, "429", now);
    s.markPair("direct", "fpA", "hy3-free", 300_000, "429", now);
    s.markSuccess("direct", "fpA", "big-pickle");
    assert.strictEqual(s.isPairCooled("direct", "fpA", "big-pickle", now + 1), false);
    assert.strictEqual(s.isPairCooled("direct", "fpA", "hy3-free", now + 1), true);
  });
});

describe("opencodePairCooldown: upstream cooldown parsing", () => {
  function headers(init: Record<string, string>): Headers {
    return new Headers(init);
  }

  it("parses Retry-After as seconds-from-now", () => {
    const ms = parseUpstreamCooldownMs(headers({ "retry-after": "120" }), "");
    assert.ok(ms !== null);
    assert.strictEqual(Math.round(ms! / 1000), 120);
  });

  it("parses Retry-After HTTP-date", () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseUpstreamCooldownMs(headers({ "retry-after": future }), "");
    assert.ok(ms !== null && ms! > 0 && ms! <= 6000);
  });

  it("parses X-RateLimit-Reset epoch-seconds and epoch-ms", () => {
    const secsMs = parseUpstreamCooldownMs(
      headers({ "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 120) }),
      ""
    );
    assert.ok(typeof secsMs === "number");
    assert.ok((secsMs as number) > 100_000 && (secsMs as number) < 140_000, "~120s from now");
    const msMs = parseUpstreamCooldownMs(
      headers({ "x-ratelimit-reset": String(Date.now() + 120_000) }),
      ""
    );
    assert.ok(typeof msMs === "number");
    assert.ok((msMs as number) > 100_000 && (msMs as number) < 140_000, "~120s from now");
  });

  it("parses body 'Resets in N days/hours'", () => {
    assert.ok(parseUpstreamCooldownMs(null, "Monthly usage limit reached. Resets in 13 days."));
    const ms = parseUpstreamCooldownMs(null, "Rate limit. Resets in 2 hours.");
    assert.ok(ms !== null);
    assert.strictEqual(ms, 2 * 3600 * 1000);
  });

  it("returns null when the upstream says nothing (no guessing)", () => {
    assert.strictEqual(parseUpstreamCooldownMs(null, "rate limit reached"), null);
    assert.strictEqual(parseUpstreamCooldownMs(headers({}), ""), null);
  });
});

describe("opencodePairCooldown: account-wide classification", () => {
  it("detects account/IP-wide quota from bodies", () => {
    assert.strictEqual(isAccountWideQuotaBody("Monthly usage limit reached"), true);
    assert.strictEqual(isAccountWideQuotaBody('"error":"organization_quota_exceeded"'), true);
    assert.strictEqual(isAccountWideQuotaBody("plan_limit_reached"), true);
    assert.strictEqual(isAccountWideQuotaBody("model-specific hiccup"), false);
  });

  it("detects account-wide quota from headers when remaining==0", () => {
    assert.strictEqual(
      isAccountWideQuotaHeaders(new Headers({ "x-ratelimit-remaining-requests": "0" })),
      true
    );
    assert.strictEqual(
      isAccountWideQuotaHeaders(new Headers({ "x-ratelimit-remaining-tokens": "0" })),
      true
    );
    assert.strictEqual(
      isAccountWideQuotaHeaders(new Headers({ "x-ratelimit-remaining-requests": "5" })),
      false
    );
    assert.strictEqual(isAccountWideQuotaHeaders(new Headers({})), false);
  });

  it("classifyUpstream429 combines headers+body", () => {
    const r = classifyUpstream429(
      new Headers({ "retry-after": "900" }),
      "Monthly usage limit reached. Resets in 13 days."
    );
    assert.strictEqual(r.accountWide, true);
    assert.ok(r.cooldownMs !== null);
  });

  it("classifyUpstream429 is model-scoped when neither signal is account-wide", () => {
    const r = classifyUpstream429(null, "some model is busy");
    assert.strictEqual(r.accountWide, false);
    assert.strictEqual(r.cooldownMs, null);
  });
});
