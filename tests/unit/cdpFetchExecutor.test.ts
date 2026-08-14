 import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * Focused unit coverage for the CDP fetch executor's gating + error paths.
 * The real Chrome in-page fetch path is exercised by the VPS live test (it
 * requires an attached/launched Chrome, which CI cannot guarantee).
 */
test("cdpFetchExecutor: isCdpBindingEnabled is false by default (opt-in)", async () => {
  delete process.env.WEB_PROVIDER_CDP_BIND;
  const { isCdpBindingEnabled } = await import(
    "../../open-sse/services/cdpFetchExecutor.ts"
  );
  assert.equal(isCdpBindingEnabled(), false);
});

test("cdpFetchExecutor: force bypasses the flag", async () => {
  delete process.env.WEB_PROVIDER_CDP_BIND;
  const { isCdpBindingEnabled } = await import(
    "../../open-sse/services/cdpFetchExecutor.ts"
  );
  assert.equal(isCdpBindingEnabled(true), true);
});

test("cdpFetchExecutor: cdpFetch rejects when binding is disabled", async () => {
  delete process.env.WEB_PROVIDER_CDP_BIND;
  const { cdpFetch } = await import("../../open-sse/services/cdpFetchExecutor.ts");
  await assert.rejects(
    () => cdpFetch({ url: "https://example.com" }),
    /WEB_PROVIDER_CDP_BIND is disabled/
  );
});

test("cdpFetchExecutor: cdpFetchStream rejects when binding is disabled", async () => {
  delete process.env.WEB_PROVIDER_CDP_BIND;
  const { cdpFetchStream } = await import("../../open-sse/services/cdpFetchExecutor.ts");
  await assert.rejects(
    () => cdpFetchStream({ url: "https://example.com" }),
    /WEB_PROVIDER_CDP_BIND is disabled/
  );
});