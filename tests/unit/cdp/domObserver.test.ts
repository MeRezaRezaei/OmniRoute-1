import test from 'node:test';
import assert from 'node:assert';
import { setupDomStreamObserver } from '../../../open-sse/services/cdp/domObserver.js';

test('setupDomStreamObserver pushes evaluation function to page', async () => {
    let evaluateCalledWith: string | null = null;
    let exposedFunctionName: string | null = null;
    
    const page: import("playwright-core").Page = {
        exposeFunction: async (name: string, fn: unknown) => {
            exposedFunctionName = name;
        },
        evaluate: async (fn: unknown, args: unknown) => { 
            evaluateCalledWith = typeof fn;
            return true;
        }
    };
    
    await setupDomStreamObserver(page, '#stream');
    assert.strictEqual(evaluateCalledWith, 'function');
    assert.strictEqual(exposedFunctionName, 'onStreamOutput');
});
