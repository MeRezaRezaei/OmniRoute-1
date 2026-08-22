import { chromium } from 'playwright-core';

async function run() {
    console.log("[*] Booting Native Linux Chrome directly via Playwright...");
    const browser = await chromium.launch({ 
        executablePath: '/opt/google/chrome/chrome',
        headless: true, 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] 
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    
    try {
        console.log("[*] Navigating to DuckDuckGo AI Chat (No-login provider) ...");
        await page.goto('https://duckduckgo.com/?q=DuckDuckGo&ia=chat', { waitUntil: 'load' });
        await page.waitForTimeout(3000);
        
        console.log("[*] Looking for 'Get Started' button...");
        try {
            await page.getByRole('button', { name: "Get Started" }).click({ timeout: 3000 });
            await page.waitForTimeout(1000);
            await page.getByRole('button', { name: "I Agree" }).click({ timeout: 3000 });
            await page.waitForTimeout(2000);
        } catch(e) {
            console.log("No welcome screen detected, proceeding to chat.");
        }

        let inputFound = false;
        for (const sel of ['textarea', 'div[contenteditable="true"]', 'input[type="text"]']) {
            const count = await page.locator(sel).count();
            if (count > 0) {
                console.log(`[*] Found chat input targeting selector: ${sel}`);
                await page.locator(sel).last().focus();
                inputFound = true;
                break;
            }
        }
        
        if (!inputFound) throw new Error("No acceptable chat input element found.");
        
        console.log("[*] Sending arithmetic problem: What is 15 + 23?");
        await page.keyboard.type("What is 15 + 23? Reply with only the final number.");
        await page.keyboard.press('Enter');
        
        console.log("[*] Awaiting AI calculation (7 seconds)...");
        await page.waitForTimeout(7000);
        
        const bodyContent = await page.evaluate(() => document.body.innerText);
        
        console.log("\n=== AI PROVIDER RESPONSE ===");
        const lines = bodyContent.split('\n');
        console.log(lines.slice(-15).join('\n'));
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
