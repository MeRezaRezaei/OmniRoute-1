import { BaseExecutor } from "./base.ts";
import type { ProviderConfig, ProviderGatewayRequest } from "../types.ts";
import { executeAcpAction } from "../protocols/acp/actions.ts";

export class CdpWebExecutor extends BaseExecutor {
  constructor(config: ProviderConfig) {
    super('cdp-web', config);
  }

  async execute(request: ProviderGatewayRequest, res: any): Promise<void> {
    // This is a stub to satisfy the system, we will inject Playwright logic here
    console.log("CdpWebExecutor.execute called. We would bring Chrome up here.");
  }
}
