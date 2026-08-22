import { chromium } from 'playwright-core';
import { execSync } from 'child_process';
import * as fs from 'fs';

async function run() {
    console.log("[*] Setting up Ghost Profile to bypass Chrome Singleton Lock...");
    const targetDir = "/tmp/omni-cdp-ghost/Default";
    
    console.log("[*] Booting Ghost Chrome via Playwright...");
    const browserContext = await chromium.launchPersistentContext(
        '/tmp/omni-cdp-ghost',
        {
            executablePath: '/usr/bin/google-chrome',
            headless: true, // Headless allows running without X11 crashes
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-sandbox', 
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-dev-shm-usage'
            ]
        }
    );
    
    console.log("[*] Chrome loaded. Mapping tabs...");
    const page = browserContext.pages()[0] || await browserContext.newPage();
    page.setDefaultTimeout(10000);
    
    try {
        console.log("[*] Navigating to https://aistudio.tencent.ai/chat ...");
        await page.goto('https://aistudio.tencent.ai/chat', { waitUntil: 'load', timeout: 15000 });
        await page.waitForTimeout(4000); 
        
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
        
        if (!inputFound) {
            console.log("[!] Taking screenshot of failure to /tmp/tencent_fail.png");
            await page.screenshot({ path: '/tmp/tencent_fail.png' });
            throw new Error("No acceptable chat input element found. The site threw a captcha or the login hydration failed.");
        }
        
        console.log("[*] Sending arithmetic problem: What is 15 + 23?");
        await page.keyboard.type("What is 15 + 23? Reply with only the final number.");
        await page.keyboard.press('Enter');
        
        console.log("[*] Awaiting AI calculation (7 seconds)...");
        await page.waitForTimeout(7000);
        
        const bodyContent = await page.evaluate(() => document.body.innerText);
        
        console.log("\n=== TENCENT AI STUDIO RESPONSE ===");
        const lines = bodyContent.split('\n');
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
