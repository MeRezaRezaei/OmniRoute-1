import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DeepSeekWebWithAutoRefreshExecutor } from "../../open-sse/executors/deepseek-web-with-auto-refresh.ts";

const CURRENT_ENDPOINT = "https://chat.deepseek.com/api/v0/users/current";

type RefreshProbe = {
  currentUserToken: string;
  sessionValid: boolean;
  doRefreshSession: () => Promise<void>;
};

describe("DeepSeekWebWithAutoRefreshExecutor doRefreshSession rotation", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // Regression for the auto-rotation bug where `const maxRefreshRetries = this.refreshConfig;`
  // (the whole config object) instead of `this.refreshConfig.maxRefreshRetries`. Comparing a
  // number with an object (`0 < {}`) is always false, so the re-mint retry loop never iterated
  // and every refresh attempt threw "Failed to refresh session after max retries". Net effect:
  // DeepSeek auto-rotate was dead — a valid userToken was never re-minted into a fresh access
  // token, so requests surfaced 401 at every refresh boundary.
  it("re-mints access token for a valid userToken (retry loop actually runs)", async () => {
    let currentCalls = 0;
    globalThis.fetch = async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/v0/users/current")) {
        currentCalls++;
        return new Response(
          JSON.stringify({
            code: 0,
            data: { biz_data: { token: "fresh-access-token-" + currentCalls } },
          }),
          { status: 200 }
        );
      }
      return new Response("{}", { status: 200 });
    };

    const executor = new DeepSeekWebWithAutoRefreshExecutor({ autoRefresh: false });
    const probe = executor as unknown as RefreshProbe;
    probe.currentUserToken = "valid-user-token";
    await probe.doRefreshSession();

    assert.ok(currentCalls >= 1, "token endpoint should have been called at least once");
    assert.strictEqual(
      probe.sessionValid,
      true,
      "session should be marked valid after a successful refresh"
    );
  });

  it("rejects after exhausting retries when the token endpoint keeps failing", async () => {
    let calls = 0;
    globalThis.fetch = async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("/v0/users/current")) {
        calls++;
        throw new Error("network down");
      }
      return new Response("{}", { status: 200 });
    };

    const executor = new DeepSeekWebWithAutoRefreshExecutor({ autoRefresh: false });
    const probe = executor as unknown as RefreshProbe;
    probe.currentUserToken = "valid-user-token";

    await assert.rejects(async () => {
      await probe.doRefreshSession();
    });
    assert.ok(calls >= 1, "token endpoint should have been attempted");
  });
});
