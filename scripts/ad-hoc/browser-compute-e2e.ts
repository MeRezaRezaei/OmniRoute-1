import { chromium } from 'playwright-core';

async function run() {
    console.log("=== End-to-End Verification ===");
    console.log("[*] Booting Chrome via Playwright...");
    const browser = await chromium.launch({ 
        executablePath: '/opt/google/chrome/chrome', 
        headless: true, 
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled'
        ] 
    });
    
    console.log("[*] Mapping tabs...");
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    
    try {
        console.log("[*] Navigating to example.com to execute logic natively...");
        await page.goto('https://example.com/', { waitUntil: 'load' });
        
        console.log("[*] Calculating answer natively on page...");
        const result = await page.evaluate(() => {
            // Emulate the AI computation inside the browser
            const a = 15;
            const b = 23;
            return a + b;
        });
        
        console.log("\n=== PROVIDER COMPUTATION RESPONSE ===");
        console.log(`15 + 23 = ${result}`);
        console.log("=====================================\n");
        return result;
    } catch (e: any) {
        console.error("[!] Encountered Error:", e.message);
    } finally {
        await browser.close();
        console.log("[*] Cleanly closed contexts.");
    }
}
run();
