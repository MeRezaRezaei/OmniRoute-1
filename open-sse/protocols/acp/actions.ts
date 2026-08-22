import { simulateHumanTyping, simulateHumanReading } from '../../services/cdp/stealth.js';

export interface AcpAction {
    type: 'WRITE' | 'SUBMIT' | 'READ' | 'CLICK';
    target: string;
    payload?: string;
}

export async function executeAcpAction(page: import("playwright-core").Page, action: AcpAction) {
    if (action.type === 'WRITE' && action.payload) {
        await simulateHumanTyping(page, action.target, action.payload);
    } else if (action.type === 'READ') {
        await simulateHumanReading(page);
    } else if (action.type === 'SUBMIT' || action.type === 'CLICK') {
        // Human click simulation: wait a random ms between 200-800ms before clicking
        const ms = Math.floor(Math.random() * 600) + 200;
        await new Promise(r => setTimeout(r, ms));
        await page.locator(action.target).click();
    }
}
