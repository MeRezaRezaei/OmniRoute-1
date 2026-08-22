import test from 'node:test';
import assert from 'node:assert';
import { setupDomStreamObserver } from '../../../open-sse/services/cdp/domObserver.js';

test('setupDomStreamObserver pushes evaluation function to page', async () => {
    let evaluateCalledWith: string | null = null;
    let exposedFunctionName: string | null = null;
    
    const page: any = {
        exposeFunction: async (name: string, fn: any) => {
            exposedFunctionName = name;
        },
        evaluate: async (fn: any, args: any) => { 
            evaluateCalledWith = typeof fn;
            return true;
        }
    };
    
    await setupDomStreamObserver(page, '#stream');
    assert.strictEqual(evaluateCalledWith, 'function');
    assert.strictEqual(exposedFunctionName, 'onStreamOutput');
});
