import test from 'node:test';
import assert from 'node:assert';
import { launchNativeProfile } from '../../../open-sse/services/cdp/persistentSession.js';

test('launchNativeProfile ignores automation flags', async () => {
    let capturedArgs: string[] = [];
    const mockChromium: unknown = {
        launchPersistentContext: async (dir: string, options: Record<string, unknown>) => {
            capturedArgs = options.ignoreDefaultArgs || [];
            return {
                pages: () => [{
                    goto: async () => {},
                }]
            };
        }
    };
    
    await launchNativeProfile('/tmp/mock-dir', mockChromium);
    assert.ok(capturedArgs.includes('--enable-automation'), '--enable-automation should be ignored for stealth');
});
