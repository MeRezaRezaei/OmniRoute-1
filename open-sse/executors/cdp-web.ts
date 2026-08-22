import { BaseExecutor } from "./base.js";
import type { ProviderConfig, ProviderGatewayRequest } from "../types.js";
import { executeAcpAction } from "../protocols/acp/actions.js";
import { launchNativeProfile } from "../services/cdp/persistentSession.js";
import { setupDomStreamObserver } from "../services/cdp/domObserver.js";

export class CdpWebExecutor extends BaseExecutor {
  constructor(config: ProviderConfig) {
    super('cdp-web', config);
  }

  async execute(request: ProviderGatewayRequest, res: import("express").Response): Promise<void> {
    const userDataDir = process.env.CDP_USER_DATA_DIR || '/tmp/omniroute-cdp-profile';
    
    // 1. Layer 1: Bring Chrome up persistently hiding automation flags
    const { context, page } = await launchNativeProfile(userDataDir);

    try {
        // 2. Navigate to provider (would be dynamic based on configuration)
        const targetUrl = typeof this.config.baseUrl === 'string' ? this.config.baseUrl : 'about:blank';
        await page.goto(targetUrl);

        // 3. Layer 2: Setup DOM mutation observer to stream chunks back without API intercepts
        const streamSelector = this.config.options?.streamSelector || '.stream-output';
        await setupDomStreamObserver(page, streamSelector);

        // 4. Layer 3: Convert the incoming request into ACP Actions and execute with human-stealth
        // Assuming the last message is what we want to submit
        const lastMessage = request.messages[request.messages.length - 1];
        if (lastMessage && lastMessage.content && typeof lastMessage.content === 'string') {
            const inputSelector = this.config.options?.inputSelector || 'textarea';
            await executeAcpAction(page, { type: 'WRITE', target: inputSelector, payload: lastMessage.content });
            
            const submitSelector = this.config.options?.submitSelector || 'button[type="submit"]';
            await executeAcpAction(page, { type: 'SUBMIT', target: submitSelector });
        }

        // Wait for visual output to finish streaming via the DOM Observer we set up earlier
        // (In a real implementation, we'd await a specific 'done' event from the DOM or timeout)
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // Finalize response
        res.end();

    } catch (error) {
        console.error("CDP Executor Error:", error);
        res.status(500).json({ error: "Agentic provider execution failed" });
    } finally {
        // Leave the context alive for state persistence if pooled, or close if isolated
        // await context.close();
    }
  }
}
