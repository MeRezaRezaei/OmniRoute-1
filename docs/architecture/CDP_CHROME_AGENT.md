# CDP Chrome Agent Architecture

The Chrome DevTools Protocol (CDP) orchestrator seamlessly binds Agent-to-Agent (A2A) commands and Agent Context Protocol (ACP) actions to a native Google Chrome profile.

### Automation Execution Environments
When launching or connecting to a live Chrome profile (to bypass anti-bot mechanisms like Cloudflare, Turnstile, or Tencent Captcha), there are exactly three ways to run Chrome sustainably:

1. **Physical Monitor & GPU**: Chrome is booted natively attached to a physical X11/Wayland display output (e.g., `DISPLAY=:0`), leveraging standard hardware rendering pipelines.
2. **Xorg Session on XRDP**: Chrome is executed headfully within an active XRDP virtual frame-buffer, supplying the necessary X-server authorization even without a physical monitor.
3. **Manual User Execution**: The user manually launches Chrome with the `--remote-debugging-port=9222` flag. OmniRoute then connects directly via WebSockets (`connectOverCDP`) to hijack tabs transparently in the background.
