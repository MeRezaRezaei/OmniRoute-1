export async function simulateHumanTyping(page: any, selector: string, text: string) {
    const min = 30;
    const max = 150;
    const variableDelay = Math.floor(Math.random() * (max - min) + min);
    
    await page.locator(selector).pressSequentially(text, { delay: variableDelay });
}

export async function simulateHumanReading(page: any) {
    const ms = Math.floor(Math.random() * 2000) + 1000;
    await new Promise(r => setTimeout(r, ms));
}
