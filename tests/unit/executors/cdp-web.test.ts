import test from 'node:test';
import assert from 'node:assert';
import { CdpWebExecutor } from '../../../open-sse/executors/cdp-web.js';

test('CdpWebExecutor instantiates correctly', () => {
    const executor = new CdpWebExecutor({} as any);
    assert.strictEqual(executor.provider, 'cdp-web');
});
