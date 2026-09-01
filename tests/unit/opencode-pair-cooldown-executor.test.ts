import { describe, it, beforeEach, afterEach, before, after } from "node:test";
import assert from "node:assert";
import net from "node:net";
import { OpencodeExecutor } from "../../open-sse/executors/opencode.ts";
import type { ExecutorLog } from "../../open-sse/executors/base.ts";
import { buildEgressKey } from "../../open-sse/executors/opencodePairCooldown.ts";
import { resolveProxyForRequest } from "../../open-sse/utils/proxyFetch.ts";

/**
 * #opencode-pair-cooldown — the opencode free tier quotes by
 * (egress IP × account × model), but the connection-level cooldown froze the
 * WHOLE connection on any 429, so "changing the proxy did nothing". These tests
 * pin the per-(egress, account, model) cooldown wired into the
 * OpencodeExecutor rotation:
 *
 *  1. A 429 on (couple A, model M) cools ONLY that trio — the store records it,
 *     and a subsequent request for model M skips couple A while couple B is
 *     tried. A DIFFERENT model on couple A is still served.
 *  2. The cooldown lasts exactly as long as the upstream says (Retry-After).
 *  3. An account/IP-wide 429 on a couple cools every model on that couple.
 *  4. A successful dispatch clears the pair's cooldown, so couple A is eligible
 *     again.
 *  5. The SAME executor instance (process-singleton) persists the cooldown
 *     across requests — "next request uses another proxy in the list."
 *
 * Dispatch is mocked by stubbing globalThis.fetch; two throwaway local TCP
 * listeners stand in for the proxies so the reachability probe passes. The SAME
 * executor instance is reused across execute() calls so cross-request cooldown
 * persistence is observable.
 */

const log: ExecutorLog = { debug() {}, info() {}, warn() {}, error() {} };

const ACCOUNT_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const ACCOUNT_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

const MODEL_X = "deepseek-v4-flash-free";
const MODEL_Y = "mimo-v2.5-free";

let serverA: net.Server;
let serverB: net.Server;
let portA = 0;
let portB = 0;

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as net.AddressInfo).port);
    });
  });
}

before(async () => {
  serverA = net.createServer((s) => s.destroy());
  serverB = net.createServer((s) => s.destroy());
  portA = await listen(serverA);
  portB = await listen(serverB);
});

after(() => {
  serverA?.close();
  serverB?.close();
});

function credentialsWithProxies() {
  return {
    apiKey: null,
    accessToken: null,
    connectionId: "noauth",
    providerSpecificData: {
      fingerprints: [ACCOUNT_A, ACCOUNT_B],
      accountProxies: [
        { fingerprint: ACCOUNT_A, proxy: { type: "http", host: "127.0.0.1", port: portA } },
        { fingerprint: ACCOUNT_B, proxy: { type: "http", host: "127.0.0.1", port: portB } },
      ],
    },
  } as any;
}

function execute(exec: OpencodeExecutor, model: string) {
  return exec.execute({
    model,
    body: { messages: [{ role: "user", content: "hi" }], stream: false },
    stream: false,
    signal: null,
    credentials: credentialsWithProxies(),
    log,
  }) as Promise<{ response: Response }>;
}

describe("OpencodeExecutor per-(egress,account,model) cooldown", () => {
  let originalFetch: typeof globalThis.fetch;
  let observed: Array<{ port: string | null }>;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    observed = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  /** Stub fetch, recording the egress port per dispatch, returning `statuses` in order. */
  function installFetchStub(statuses: number[], headers: Record<string, string> = {}) {
    let call = 0;
    const eff = Array.isArray(statuses) ? statuses : Array(statuses).fill(200);
    globalThis.fetch = (async (input: any) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const resolved = resolveProxyForRequest(url);
      let port: string | null = null;
      try {
        if (resolved.proxyUrl) port = new URL(resolved.proxyUrl).port;
      } catch {
        port = resolved.proxyUrl;
      }
      observed.push({ port });
      const s = eff[Math.min(call, eff.length - 1)];
      call++;
      return new Response(JSON.stringify({}), { status: s, headers });
    }) as typeof globalThis.fetch;
  }

  it("a 429 on couple A marks exactly that (egress,account,model) — siblings untouched (#pair-cooldown)", async () => {
    const exec = new OpencodeExecutor("opencode-zen");
    // Couple A 429 for MODEL_X, couple B 200 → request overall 200 (rotation works).
    installFetchStub([429, 200]);
    const res = await execute(exec, MODEL_X);
    assert.strictEqual(res.response.status, 200);

    const egressA = buildEgressKey({ type: "http", host: "127.0.0.1", port: portA });
    const egressB = buildEgressKey({ type: "http", host: "127.0.0.1", port: portB });
    // Couple A + MODEL_X is cooled.
    assert.strictEqual(
      exec.pairCooldownState.isPairCooled(egressA, ACCOUNT_A, MODEL_X),
      true,
      "couple A + model X must be cooled after its 429"
    );
    // Sibling couple B, same model → live.
    assert.strictEqual(exec.pairCooldownState.isPairCooled(egressB, ACCOUNT_B, MODEL_X), false);
    // Same couple A but DIFFERENT model → live (model-scoped 429).
    assert.strictEqual(
      exec.pairCooldownState.isPairCooled(egressA, ACCOUNT_A, MODEL_Y),
      false,
      "model-scoped 429 must not take down a sibling model on the same couple"
    );
    // Different egress (proxy) for the same account → live (the core "try another proxy").
    assert.strictEqual(
      exec.pairCooldownState.isPairCooled(egressB, ACCOUNT_A, MODEL_X),
      false,
      "a different egress for the same account/fingerprint must still be live"
    );
  });

  it("the next request for the same model skips the cooled couple and serves the other (#pair-cooldown)", async () => {
    const exec = new OpencodeExecutor("opencode-zen");
    // Request 1: couple A 429 (MODEL_X), couple B 200.
    installFetchStub([429, 200]);
    await execute(exec, MODEL_X);

    // Request 2, same executor, model MODEL_X: couple A is cooled → couple B serves.
    installFetchStub([200, 200]);
    observed = [];
    const res = await execute(exec, MODEL_X);
    assert.strictEqual(res.response.status, 200);
    assert.ok(
      observed.some((o) => o.port === String(portB)),
      `couple B must be tried for the cooled model; got=${JSON.stringify(
        observed.map((o) => o.port)
      )}`
    );
    assert.ok(
      observed.every((o) => o.port === String(portB)),
      `the cooled couple A (port ${portA}) must NOT be dispatched again for MODEL_X; got=${JSON.stringify(
        observed.map((o) => o.port)
      )}`
    );
  });

  it("honors the upstream Retry-After duration for a model-scoped 429 (#pair-cooldown)", async () => {
    const exec = new OpencodeExecutor("opencode-zen");
    // Couple A 429 with Retry-After: 900s, couple B 200.
    installFetchStub([429, 200], { "Retry-After": "900" });
    await execute(exec, MODEL_X);

    const egressA = buildEgressKey({ type: "http", host: "127.0.0.1", port: portA });
    const cooledUntil = exec.pairCooldownState.getPairCooledUntil(egressA, ACCOUNT_A, MODEL_X);
    const remaining = cooledUntil - Date.now();
    assert.ok(
      remaining >= 850_000 && remaining <= 905_000,
      `cooldown must honor the 900s Retry-After (not an app timer); got ${Math.round(remaining / 1000)}s`
    );
  });

  it("an account/IP-wide 429 cools every model on the couple (#pair-cooldown)", async () => {
    const exec = new OpencodeExecutor("opencode-zen");
    // Couple A account-wide 429 (remaining-requests: 0), couple B 200.
    installFetchStub([429, 200], { "x-ratelimit-remaining-requests": "0" });
    await execute(exec, MODEL_X);

    const egressA = buildEgressKey({ type: "http", host: "127.0.0.1", port: portA });
    // The account-wide 429 must cool MODEL_X AND MODEL_Y on couple A (family scope).
    assert.strictEqual(exec.pairCooldownState.isPairCooled(egressA, ACCOUNT_A, MODEL_X), true);
    assert.strictEqual(
      exec.pairCooldownState.isPairCooled(egressA, ACCOUNT_A, MODEL_Y),
      true,
      "account-wide 429 must cool a sibling model on the same couple"
    );
    // Sibling couple B stays live.
    assert.strictEqual(
      exec.pairCooldownState.isPairCooled(
        buildEgressKey({ type: "http", host: "127.0.0.1", port: portB }),
        ACCOUNT_B,
        MODEL_X
      ),
      false
    );
  });

  it("a fully-successful request leaves no residual per-couple cooldown (#pair-cooldown)", async () => {
    const exec = new OpencodeExecutor("opencode-zen");
    // Everything succeeds on the first pass → no cooldown should be recorded.
    installFetchStub([200, 200]);
    const res = await execute(exec, MODEL_X);
    assert.strictEqual(res.response.status, 200);
    assert.strictEqual(
      exec.pairCooldownState.size,
      0,
      "a 200 must clear the couple's cooldown, leaving no stale entries"
    );
  });
});
