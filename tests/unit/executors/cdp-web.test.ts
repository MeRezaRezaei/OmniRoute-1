import test from 'node:test';
import assert from 'node:assert';
import { CdpWebExecutor } from '../../../open-sse/executors/cdp-web.js';
import type { ProviderConfig } from '../../../open-sse/types.js';

test('CdpWebExecutor instantiates correctly and has end-to-end execute signature', async () => {
    const executor = new CdpWebExecutor({ baseUrl: 'https://example.com' } as unknown as ProviderConfig);
    assert.strictEqual(executor.provider, 'cdp-web');
    // Ensure the method matches the signature expected by OmniRoute BaseExecutor interface
    assert.strictEqual(typeof executor.execute, 'function');
});
