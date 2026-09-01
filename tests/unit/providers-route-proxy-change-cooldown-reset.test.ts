import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { makeManagementSessionRequest } from "../helpers/managementSession.ts";

const TEST_DATA_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), "omniroute-proxy-change-cooldown-reset-")
);
process.env.DATA_DIR = TEST_DATA_DIR;

const core = await import("../../src/lib/db/core.ts");
const providersDb = await import("../../src/lib/db/providers.ts");

test.after(() => {
  core.resetDbInstance();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true });
});

/**
 * #pair-cooldown — "changing the proxy did nothing". The opencode free tier is
 * IP-bucketed: a 429 on egress IP A persisted `rateLimitedUntil` /
 * `testStatus: unavailable` on the connection, and that DB-level cooldown kept
 * blocking requests EVEN AFTER the operator pointed the account at a new proxy
 * (egress IP B). The provider update route must clear the persisted cooldown
 * when the proxy wiring changes, so the fresh egress is immediately eligible
 * (the executor's in-memory per-(egress,account,model) store re-buckets).
 */
test("updating accountProxies clears the connection's persisted rate-limit cooldown (#pair-cooldown)", async () => {
  const cooldown = new Date(Date.now() + 60_000).toISOString();
  const created = await providersDb.createProviderConnection({
    provider: "opencode",
    authType: "noauth",
    name: "opencode free",
    providerSpecificData: {
      fingerprints: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
    },
  });
  const conn = created as { id: string };

  // Simulate a real 429 having cooled the connection for the current egress.
  await providersDb.updateProviderConnection(conn.id, {
    testStatus: "unavailable",
    rateLimitedUntil: cooldown,
    backoffLevel: 2,
  });

  // Operator changes the proxy wiring to a NEW egress.
  const route = await import("../../src/app/api/providers/[id]/route.ts");
  const ctx = { params: Promise.resolve({ id: conn.id }) };
  const request = await makeManagementSessionRequest(`http://localhost/api/providers/${conn.id}`, {
    method: "PATCH",
    body: {
      providerSpecificData: {
        accountProxies: [
          {
            fingerprint: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            proxy: { type: "http", host: "10.0.0.2", port: 40001 },
          },
          {
            fingerprint: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            proxy: { type: "http", host: "10.0.0.2", port: 40002 },
          },
        ],
      },
    },
  });

  // PATCH must be routed (PATCH handler) and succeed.
  const response = await route.PATCH(request, ctx);
  assert.notEqual(response.status, 405, "proxy change must go through the routed PATCH handler");

  const after = (await providersDb.getProviderConnectionById(conn.id)) as {
    rateLimitedUntil: string | null | undefined;
    testStatus: string | null | undefined;
    backoffLevel: number | null | undefined;
  } | null;
  assert.ok(after, "connection must still exist after the proxy change");
  assert.ok(
    after?.rateLimitedUntil == null,
    `persisted rate-limit cooldown must be cleared when the proxy wiring changes; got ${after?.rateLimitedUntil}`
  );
  assert.strictEqual(
    after?.testStatus,
    "active",
    "the new egress must be immediately eligible (testStatus active)"
  );
  assert.ok(
    after?.backoffLevel === 0 || after?.backoffLevel == null,
    "backoff level must reset with the cooldown"
  );
});
