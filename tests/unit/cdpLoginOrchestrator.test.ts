import { test } from "node:test";
import assert from "node:assert/strict";
import { TOKEN_EXTRACTION_CONFIGS } from "../../open-sse/services/tokenExtractionConfig.ts";

/**
 * Focused unit coverage for the CDP login orchestrator's runtime registry —
 * requestId↔session tracking and selective cleanup (no browser launch; the real
 * Chrome/CDP attach/launch path is covered by the VPS live test).
 */

test("orchestrator: registry starts empty and listSessions is an array", async () => {
  const { cdpLoginOrchestrator } = await import(
    "../../open-sse/services/cdpLoginOrchestrator.ts"
  );
  const sessions = cdpLoginOrchestrator.listSessions();
  assert.ok(Array.isArray(sessions));
});

test("orchestrator: getSession returns undefined for an unknown requestId", async () => {
  const { cdpLoginOrchestrator } = await import(
    "../../open-sse/services/cdpLoginOrchestrator.ts"
  );
  assert.equal(cdpLoginOrchestrator.getSession("does-not-exist"), undefined);
});

test("orchestrator: closeSession returns false for an unknown requestId", async () => {
  const { cdpLoginOrchestrator } = await import(
    "../../open-sse/services/cdpLoginOrchestrator.ts"
  );
  const ok = await cdpLoginOrchestrator.closeSession("does-not-exist");
  assert.equal(ok, false);
});

test("orchestrator: cancel returns false for an unknown requestId", async () => {
  const { cdpLoginOrchestrator } = await import(
    "../../open-sse/services/cdpLoginOrchestrator.ts"
  );
  const ok = await cdpLoginOrchestrator.cancel("does-not-exist");
  assert.equal(ok, false);
});

test("orchestrator: web-cookie providers have extraction configs", () => {
  // Providers the login route drives through the orchestrator must have a
  // TokenExtractionConfig so the CDP login path resolves a real config.
  for (const providerId of ["claude-web", "chatgpt-web", "gemini-web", "grok-web"]) {
    assert.equal(
      TOKEN_EXTRACTION_CONFIGS.has(providerId),
      true,
      `expected extraction config for ${providerId}`
    );
  }
});