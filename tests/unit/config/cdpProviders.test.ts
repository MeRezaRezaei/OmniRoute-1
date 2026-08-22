import test from 'node:test';
import assert from 'node:assert';
import { CDP_PROVIDER_REGISTRY } from '../../../open-sse/config/cdpProviders.js';

test('Provider registry exports strictly required selectors', () => {
    const tencent = CDP_PROVIDER_REGISTRY['tencent-aistudio-web'];
    assert.strictEqual(tencent.inputSelector, 'textarea.chat-input');
    
    assert.ok(CDP_PROVIDER_REGISTRY['deepseek-web']);
    assert.ok(CDP_PROVIDER_REGISTRY['gemini-web']);
    assert.ok(CDP_PROVIDER_REGISTRY['chatgpt-web']);
});
