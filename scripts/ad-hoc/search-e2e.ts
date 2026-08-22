import { chromium } from 'playwright-core';

async function run() {
    console.log("[*] Booting Native Linux Chrome directly via Playwright...");
    const browser = await chromium.launch({ 
        executablePath: '/opt/google/chrome/chrome',
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage', 
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
            '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        ] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    
    try {
        console.log("[*] Navigating to Google Search (Math Engine)...");
        await page.goto('https://www.google.com', { waitUntil: 'load' });
        await page.waitForTimeout(2000);

        console.log("[*] Typing arithmetic problem: What is 15 + 23?");
        const textarea = page.locator('textarea').first();
        await textarea.focus();
        await page.keyboard.type("15 + 23");
        await page.keyboard.press('Enter');
        
        console.log("[*] Awaiting computation (4 seconds)...");
        await page.waitForTimeout(4000);
        
        // Grab the calculator result box
        const result = await page.evaluate(() => {
            const el = document.querySelector('#cwos');
            return el ? el.textContent : "Not Found";
        });
        
        console.log("\n=== AI/MATH PROVIDER RESPONSE ===");
        console.log(`Result of 15 + 23 = ${result}`);
        console.log("==================================\n");
    } catch (e: any) {
        console.error("[!] Encountered Error:", e.message);
    } finally {
        await context.close();
        await browser.close();
        console.log("[*] Cleanly closed contexts.");
    }
}
run();
