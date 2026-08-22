export async function setupDomStreamObserver(page: any, selector: string) {
    // Inject a MutationObserver into the page that watches the target stream element.
    // Instead of querying via Playwright repeatedly (which is loud and slow), 
    // the page itself pushes updates back out to Node natively as they render.
    await page.exposeFunction('onStreamOutput', (newText: string) => {
        // In a full implementation, this event emitter triggers the SSE stream yield
        // console.log("Stream update:", newText);
    });

    await page.evaluate(({ selector }) => {
        const target = document.querySelector(selector);
        if (!target) return;

        let lastLength = 0;
        const observer = new MutationObserver(() => {
            const currentText = target.textContent || "";
            if (currentText.length > lastLength) {
                const diff = currentText.substring(lastLength);
                lastLength = currentText.length;
                (window as any).onStreamOutput(diff);
            }
        });

        observer.observe(target, { childList: true, subtree: true, characterData: true });
        (window as any).__streamObserver = observer;
    }, { selector });
}
