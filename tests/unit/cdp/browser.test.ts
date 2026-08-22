import test from 'node:test';
import assert from 'node:assert';
import { CdpBrowserSession } from '../../../open-sse/services/cdp/browser.js';

test('CdpBrowserSession sets up cdpUrl correctly', () => {
    const session = new CdpBrowserSession('http://localhost:9222');
    // Using string matching as properties are private without getters
    assert.strictEqual(JSON.stringify(session).includes('http://localhost:9222'), true);
});
