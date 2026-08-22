import type { Page } from 'playwright-core';

/**
 * Executes a read check against the live browser DOM to allow 
 * the orchestrator model to determine if the provider is in a valid state
 * (e.g. verifying anti-bot challenge is absent, or login input is visible).
 */
export async function verifyPageDomState(page: Page, stateSelector: string): Promise<string> {
    const content = await page.evaluate(({ selector }) => {
        const el = document.querySelector(selector);
        return el ? (el.textContent || "") : "ELEMENT_NOT_FOUND";
    }, { selector: stateSelector });
    
    return content;
}
