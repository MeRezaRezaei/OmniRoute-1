async function run() {
    console.log("=== End-to-End AI Verification ===");
    console.log("-> Sending prompt: 'What is 15 + 23? Reply exactly and only with the sum number.'");
    
    try {
        const response = await fetch("https://huggingface.co/api/models/Qwen/Qwen2.5-Coder-32B-Instruct/v1/chat/completions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: "Qwen/Qwen2.5-Coder-32B-Instruct",
                messages: [{ role: "user", content: "What is 15 + 23? Reply only with the final number. Do not say anything else." }],
                max_tokens: 10,
                stream: false
            })
        });

        const text = await response.json();
        console.log("\n=== AI PROVIDER RESPONSE ===");
        console.log(text.choices?.[0]?.message?.content?.trim() || "FAILED");
        console.log("==============================\n");
    } catch (e: any) {
        console.error("[!] Request failed:", e.message);
    }
}
run();
