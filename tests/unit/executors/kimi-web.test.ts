import test from 'node:test';
import assert from 'node:assert';
import { KimiWebExecutor } from '../../../open-sse/executors/kimi-web.js';
import { CdpWebExecutor } from '../../../open-sse/executors/cdp-web.js';
import type { ProviderConfig } from '../../../open-sse/types.js';

test('KimiWebExecutor inherits from CdpWebExecutor', () => {
    const executor = new KimiWebExecutor({} as unknown as ProviderConfig);
    assert.ok(executor instanceof CdpWebExecutor, 'Executor should inherit CDP functionality');
});
