import type { Page } from 'playwright-core';

export async function waitForStreamCompletion(page: Page, streamSelector: string, debounceMs: number = 2000): Promise<void> {
    await page.evaluate(async ({ selector, debounceMs }) => {
        return new Promise<void>((resolve) => {
            const target = document.querySelector(selector);
            if (!target) {
                resolve();
                return;
            }

            let timeout: NodeJS.Timeout;
            const observer = new MutationObserver(() => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    observer.disconnect();
                    resolve();
                }, debounceMs);
            });

            timeout = setTimeout(() => {
                observer.disconnect();
                resolve();
            }, debounceMs);

            observer.observe(target, { childList: true, subtree: true, characterData: true });
        });
    }, { selector: streamSelector, debounceMs });
}
