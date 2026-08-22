import { CdpWebExecutor } from "./cdp-web.js";
import type { ProviderConfig, ProviderGatewayRequest } from "../types.js";

const AISTUDIO_BASE = "https://aistudio.tencent.ai";

export class TencentAIStudioWebExecutor extends CdpWebExecutor {
  constructor(config?: Partial<ProviderConfig>) {
    super(Object.assign({ 
      id: "tencent-aistudio-web", 
      baseUrl: AISTUDIO_BASE,
      options: {
        inputSelector: 'textarea.chat-input',
        submitSelector: 'button.send-btn',
        streamSelector: '.message-stream-body'
      }
    }, config));
    // Explicitly set provider name as the BaseExecutor requires it to match
    this.provider = "tencent-aistudio-web";
  }

  async execute(request: ProviderGatewayRequest, res: import('express').Response): Promise<void> {
     await super.execute(request, res);
  }
}
