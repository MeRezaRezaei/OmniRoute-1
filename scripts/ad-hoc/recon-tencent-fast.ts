import { chromium } from 'playwright-core';

async function recon() {
    try {
        console.log("Connecting to live Chrome CDP...");
        const browser = await chromium.connectOverCDP({
            endpointURL: 'http://localhost:9222',
            timeout: 10000
        });
        console.log("Connected. Getting context...");
        const context = browser.contexts()[0];
        console.log("Creating new tab...");
        const page = await context.newPage();
        
        console.log("Navigating to Tencent AI Studio...");
        await page.goto('https://aistudio.tencent.ai/', { waitUntil: 'domcontentloaded', timeout: 15000 }); 
        console.log("Navigation complete. Evaluating DOM...");
        
        const inputs = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('textarea, [contenteditable="true"]')).map(el => {
                return `<${el.tagName.toLowerCase()} class="${el.className}" id="${el.id}">`;
            });
        });
        
        console.log("Inputs found:", inputs);
        
        await page.close();
        await browser.close();
        console.log("DONE");
    } catch (e: any) {
        console.error("Recon failed:", e.message);
    }
}
recon().then(() => process.exit(0));
