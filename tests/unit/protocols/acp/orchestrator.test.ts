import test from 'node:test';
import assert from 'node:assert';
import { verifyPageDomState } from '../../../../open-sse/protocols/acp/orchestrator.js';
import type { Page } from 'playwright-core';

test('verifyPageDomState extracts text content for analysis', async () => {
    const page = {
        evaluate: async (fn: unknown, args: { selector: string }) => {
            return "Retrieved State"; 
        }
    } as unknown as Page;
    
    const state = await verifyPageDomState(page, 'body');
    assert.strictEqual(state, "Retrieved State");
});
