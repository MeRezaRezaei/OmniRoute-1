import test from 'node:test';
import assert from 'node:assert';
import { executeAcpAction } from '../../../../open-sse/protocols/acp/actions.js';

test('executeAcpAction delegates write correctly', async () => {
    let capturedText = '';
    const page = {
        locator: () => ({
            pressSequentially: async (text: string) => { capturedText = text; }
        })
    };
    
    await executeAcpAction(page as unknown as import("playwright-core").Page, { type: 'WRITE', target: '#in', payload: 'test' });
    assert.strictEqual(capturedText, 'test');
});
