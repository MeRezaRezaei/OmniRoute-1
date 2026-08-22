import test from 'node:test';
import assert from 'node:assert';
import { simulateHumanTyping } from '../../../open-sse/services/cdp/stealth.js';

test('simulateHumanTyping yields variable intervals', async () => {
    const page = {
        locator: () => ({
            pressSequentially: async (text: string, options: { delay?: number }) => {
                assert.ok(options.delay >= 30, 'delay should be >= 30');
                assert.ok(options.delay <= 150, 'delay should be <= 150');
            }
        })
    };
    await simulateHumanTyping(page as unknown as import("playwright-core").Page, '#input', 'hello');
});
