import { chromium } from 'playwright-core';

async function run() {
    console.log("[*] Booting Chrome via Playwright...");
    const browser = await chromium.launch({ 
        executablePath: '/opt/google/chrome/chrome', // The actual system chrome 
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled' // basic stealth
        ] 
    });
    
    console.log("[*] Chrome loaded. Mapping tabs...");
    const context = await browser.newContext({
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    });
    
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    
    try {
        console.log("[*] Navigating to Google...");
        await page.goto('https://www.google.com/', { waitUntil: 'load' });
        await page.waitForTimeout(2000);
        
        console.log("[*] Verifying input node...");
        await page.locator('textarea[name="q"], input[name="q"]').first().focus();
        
        console.log("[*] Sending arithmetic problem: 15 + 23");
        await page.keyboard.type("15 + 23 =");
        await page.keyboard.press('Enter');
        
        console.log("[*] Awaiting AI calculation (3 seconds)...");
        await page.waitForTimeout(3000);
        
        const result = await page.evaluate(() => {
            const el = document.querySelector('#cwos'); // Google calculator result ID
            return el ? el.textContent : "Calculator not rendered.";
        });
        
        console.log("\n=== E2E RESPONSE ===");
        console.log(`15 + 23 = ${result}`);
        console.log("====================\n");
    } catch (e: any) {
        console.error("[!] Encountered Error:", e.message);
    } finally {
        await browser.close();
        console.log("[*] Cleanly closed contexts.");
    }
}
run();
