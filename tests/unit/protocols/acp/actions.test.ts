import test from 'node:test';
import assert from 'node:assert';
import { executeAcpAction } from '../../../../open-sse/protocols/acp/actions.js';

test('executeAcpAction delegates write correctly', async () => {
    let capturedText = '';
    const page: any = {
        locator: () => ({
            pressSequentially: async (text: string) => { capturedText = text; }
        })
    };
    
    await executeAcpAction(page, { type: 'WRITE', target: '#in', payload: 'test' });
    assert.strictEqual(capturedText, 'test');
});
