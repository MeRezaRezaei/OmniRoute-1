import { DuckDuckGoWebExecutor } from '../../open-sse/executors/duckduckgo-web.js';

async function performEndToEndVerification() {
    console.log("=== End-to-End AI Verification ===");
    console.log("-> Sending prompt: 'What is 15 + 23? Reply only with the numerical digits.'");
    
    try {
        console.log("Executing DuckDuckGo natively...");
        const executor = new DuckDuckGoWebExecutor({ id: "duckduckgo-web" } as any);
        const request = {
            model: 'duckduckgo-web/claude-3-haiku-20240307',
            messages: [{ role: 'user', content: 'What is 15 + 23? Sum only.' }],
            stream: false
        } as any;
        
        let finalAnswer = "";
        const mockResponse = {
            write: (data: string) => {
                const lines = data.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ') && line !== 'data: [DONE]') {
                        try {
                            const parsed = JSON.parse(line.substring(6));
                            if (parsed.choices && parsed.choices[0].delta.content) {
                                finalAnswer += parsed.choices[0].delta.content;
                            }
                        } catch(e) {}
                    }
                }
            },
            end: () => {},
            status: () => ({ json: () => {} }),
            writeHead: () => {}
        };
        
        await executor.execute(request, mockResponse as any);
        console.log("\n=== AI PROVIDER RESPONSE ===");
        console.log(`OUTPUT: ${finalAnswer.trim()}`);
        console.log("==============================\n");
    } catch (err) {
        console.error("Critical Failure:", err);
    }
}
performEndToEndVerification();
