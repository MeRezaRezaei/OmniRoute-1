import { CdpWebExecutor } from "./cdp-web.js";
import type { ProviderConfig, ProviderGatewayRequest } from "../types.js";

const BASE_URL = "https://www.kimi.ai";

export class KimiWebExecutor extends CdpWebExecutor {
  constructor(config?: Partial<ProviderConfig>) {
    super(Object.assign({ 
      id: "kimi-web", 
      baseUrl: BASE_URL,
      options: {
        inputSelector: 'div[contenteditable="true"]',
        submitSelector: 'button[aria-label="Send"]',
        streamSelector: '.message-list .latest-reply'
      }
    }, config));
    this.provider = "kimi-web";
  }

  async execute(request: ProviderGatewayRequest, res: import('express').Response): Promise<void> {
     await super.execute(request, res);
  }
}
