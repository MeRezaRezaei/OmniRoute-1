import test from "node:test";
import assert from "node:assert/strict";

/**
 * Regression guard: `open-sse/executors/index.ts` must not import a deleted
 * executor file. A previous build left a dead `import { DevinDesktopExecutor }
 * from "./devin-desktop.ts"` (the file never existed) which made the whole
 * executor registry fail to load with ERR_MODULE_NOT_FOUND, taking down every
 * unit test that imports the index (e.g. deepseek-web.test.ts).
 */
test("executors index loads without a missing-module import", async () => {
  await assert.doesNotReject(async () => {
    await import("../../open-sse/executors/index.ts");
  }, "executors/index.ts should load without ERR_MODULE_NOT_FOUND");
});
