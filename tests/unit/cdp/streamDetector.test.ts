import test from 'node:test';
import assert from 'node:assert';
import { waitForStreamCompletion } from '../../../open-sse/services/cdp/streamDetector.js';
import type { Page } from 'playwright-core';

test('waitForStreamCompletion evaluates debounce logic on page', async () => {
    let evaluationPassed = false;
    const page = {
        evaluate: async (fn: unknown, args: { selector: string; debounceMs: number }) => {
            assert.strictEqual(args.selector, '.reply');
            assert.strictEqual(args.debounceMs, 1000);
            evaluationPassed = true;
            return true;
        }
    } as unknown as Page;
    
    await waitForStreamCompletion(page, '.reply', 1000);
    assert.strictEqual(evaluationPassed, true);
});
