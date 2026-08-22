import { KimiWebExecutor } from '../../open-sse/executors/kimi-web.js';
import type { ProviderGatewayRequest } from '../../open-sse/types.js';
import * as http from 'http';

const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
        <html><body>
            <div contenteditable="true" aria-label="chat input" style="height: 100px; border: 1px solid black;"></div>
            <button aria-label="Send">Send</button>
            <div class="message-list"><div class="latest-reply"></div></div>
            <script>
                document.querySelector('button[aria-label="Send"]').addEventListener('click', () => {
                    const reply = document.querySelector('.latest-reply');
                    const text = "Hello from the simulated Kimi AI!";
                    let i = 0;
                    const stream = setInterval(() => {
                        reply.textContent += text[i];
                        i++;
                        if (i >= text.length) clearInterval(stream);
                    }, 50);
                });
            </script>
        </body></html>
    `);
});

server.listen(9999, async () => {
    console.log("=== Mock Provider Server Started on 9999 ===");

    const config = {
      id: "kimi-web",
      baseUrl: "http://localhost:9999",
      options: {
        inputSelector: 'div[contenteditable="true"]',
        submitSelector: 'button[aria-label="Send"]',
        streamSelector: '.message-list .latest-reply'
      }
    };
    class LocalToyWebExecutor extends KimiWebExecutor {
        constructor() { super(config); }
    }
    const executor = new LocalToyWebExecutor();
    const mockRequest: ProviderGatewayRequest = {
        model: 'kimi-web',
        messages: [{ role: 'user', content: 'Testing E2E' }]
    } as any;

    let finalCollectedResponse = "";
    
    // In our tests, executor.execute hangs. I will capture it asynchronously
    const executionTask = executor.execute(mockRequest, {
        write: (data: string) => {
            console.log(`[SSE YIELDED DATA] => ${data.trim()}`);
            const payload = JSON.parse(data.replace('data: ', ''));
            if (payload.choices && payload.choices[0].delta.content) {
                finalCollectedResponse += payload.choices[0].delta.content;
            }
        },
        end: () => console.log('Mock Response End Callback'),
        status: (code: number) => ({ json: () => {} }),
        writeHead: () => {}
    } as any);

    // Timeout the script gracefully after 10s to see what was captured
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    console.log("=== DONE ===");
    console.log(`Final Recovered Stream Answer: "${finalCollectedResponse}"`);
    server.close();
    process.exit(0);
});
