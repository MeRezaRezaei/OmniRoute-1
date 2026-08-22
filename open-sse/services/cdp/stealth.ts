export async function simulateHumanTyping(page: import("playwright-core").Page, selector: string, text: string) {
    const min = 30;
    const max = 150;
    
    // Instead of waiting on strict locator resolutions which can stall on custom DOMs,
    // evaluate the click locally or click the visual bounding box
    const element = page.locator(selector);
    
    // Force focus
    await element.evaluate((el: HTMLElement) => el.focus());
    
    // Type dynamically iterating directly on the raw keyboard
    // This perfectly mimics physical keystrokes and avoids locator hangs
    for (const char of text) {
        const variableDelay = Math.floor(Math.random() * (max - min) + min);
        await page.keyboard.type(char, { delay: variableDelay });
    }
}

export async function simulateHumanReading(page: import("playwright-core").Page) {
    const ms = Math.floor(Math.random() * 2000) + 1000;
    await new Promise(r => setTimeout(r, ms));
}
