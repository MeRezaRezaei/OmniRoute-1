import { TencentAIStudioWebExecutor } from '../../open-sse/executors/tencent-aistudio-web.js';
import type { ProviderGatewayRequest } from '../../open-sse/types.js';

async function run() {
    console.log("=== Starting CDP End-to-End Test for Tencent ===");
    
    // We expect the executor to launch chrome and run without crashing
    const executor = new TencentAIStudioWebExecutor();
    
    const mockRequest: ProviderGatewayRequest = {
        model: 'tencent-aistudio-web',
        messages: [{ role: 'user', content: 'Integration test message' }]
    } as any;

    let resolveStream: () => void;
    const streamDone = new Promise<void>(r => { resolveStream = r; });

    // Mock Express Response that our Executor writes to
    const mockResponse: any = {
        write: (data: string) => {
            console.log(`[STREAM CHUNK] ${data}`);
        },
        end: () => {
            console.log("[STREAM ENDED]");
            resolveStream();
        },
        status: (code: number) => {
            console.log(`[STATUS] ${code}`);
            return { json: (data: any) => console.log(`[JSON]`, data) };
        }
    };

    console.log("-> Calling executor.execute()...");
    await executor.execute(mockRequest, mockResponse);
    await streamDone;
    console.log("=== Test Complete ===");
}

run().catch(console.error);
