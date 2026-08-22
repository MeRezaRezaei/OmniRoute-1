import test from 'node:test';
import assert from 'node:assert';
import { TencentAIStudioWebExecutor } from '../../../open-sse/executors/tencent-aistudio-web.js';
import { CdpWebExecutor } from '../../../open-sse/executors/cdp-web.js';

test('TencentAIStudioWebExecutor inherits from CdpWebExecutor', () => {
    const executor = new TencentAIStudioWebExecutor({} as unknown as import("../../../open-sse/types.js").ProviderConfig);
    assert.ok(executor instanceof CdpWebExecutor, 'Executor should inherit CDP functionality');
    assert.strictEqual(executor.provider, 'tencent-aistudio-web');
});
