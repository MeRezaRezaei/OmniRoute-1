import { InnerAiExecutor } from '../../open-sse/executors/inner-ai.js';
import { setupEnv } from '../../open-sse/config/env.js';
setupEnv();

async function run() {
    console.log("=== End-to-End AI Verification via Inner-AI Engine ===");
    const executor = new InnerAiExecutor();
    
    let answer = "";
    const mockResponse: any = {
        write: (d: string) => {
            const dataStr = d.replace('data: ', '').trim();
            if (dataStr && dataStr !== '[DONE]') {
                try { answer += JSON.parse(dataStr).choices[0].delta.content || ''; } catch(e){}
            }
        },
        end: () => {}, status: () => ({ json: () => {} }), writeHead: () => {}
    };

    const req = {
        model: 'inner-ai',
        messages: [{ role: 'user', content: 'Output exactly the number 38' }]
    } as any;

    await executor.execute(req, mockResponse);
    console.log("\n=== AI PROVIDER RESPONSE ===");
    console.log(answer.trim() || "(silent fast-fail)");
    console.log("==============================\n");
}
run();
