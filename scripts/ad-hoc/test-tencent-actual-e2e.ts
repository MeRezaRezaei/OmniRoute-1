import { chromium } from 'playwright-core';

async function run() {
    console.log("[*] Booting Chrome via Playwright...");
    const browserContext = await chromium.launchPersistentContext(
        '/home/merezarezaei/.config/google-chrome',
        {
            executablePath: '/opt/google/chrome/chrome',
            headless: true, // Use Chrome's new headless mode
            args: ['--remote-debugging-port=9222', '--disable-blink-features=AutomationControlled']
        }
    );
    
    console.log("[*] Chrome loaded. Mapping tabs...");
    const page = browserContext.pages()[0] || await browserContext.newPage();
    page.setDefaultTimeout(10000);
    
    try {
        console.log("[*] Navigating to https://aistudio.tencent.ai/chat ...");
        await page.goto('https://aistudio.tencent.ai/chat', { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(3000); // Wait for auth hydration based on user cookies
        
        console.log("[*] Verifying input node...");
        let inputFound = false;
        
        for (const sel of ['textarea', 'div[contenteditable="true"]', 'input[type="text"]', '.chat-input']) {
            const count = await page.locator(sel).count();
            if (count > 0) {
                console.log(`[*] Found input targeting selector: ${sel}`);
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
        
        console.log("\n=== TENCENT AI STUDIO RESPONSE ===");
        const lines = bodyContent.split('\n');
        // Get the last 15 lines of the page, where the most recent answer lies
        console.log(lines.slice(-15).join('\n'));
        console.log("==================================\n");
    } catch (e: any) {
        console.error("[!] Encountered Error:", e.message);
    } finally {
        await browserContext.close();
        console.log("[*] Cleanly closed contexts.");
    }
}
run();
