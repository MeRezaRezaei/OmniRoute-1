import { chromium, type BrowserContext, type Page } from 'playwright-core';

export async function launchNativeProfile(userDataDir: string, chromiumDriver: typeof chromium = chromium): Promise<{ context: BrowserContext; page: Page }> {
    // We utilize launchPersistentContext and explicitly tell Playwright NOT to 
    // tell Chrome it is being automated. This is crucial for avoiding bans.
    const context = await chromiumDriver.launchPersistentContext(userDataDir, {
        headless: false, // Often required for stealth, real users have headed browsers
        viewport: null, // Let Chrome decide based on OS
        ignoreDefaultArgs: [
            '--enable-automation', 
            '--disable-extensions', 
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps'
        ],
        args: [
            '--disable-blink-features=AutomationControlled',
            '--start-maximized'
        ]
    });

    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    return { context, page };
}
