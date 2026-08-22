# CDP Agent Runtime, Stealth, & X11 Findings

This document preserves the critical system administration and implementation findings regarding controlling live Chrome instances via Playwright for agentic provider orchestration.

## 1. The Chrome Singleton & Default Profile Lock
Chrome has strict security blocking `--remote-debugging-port` from attaching to the default user profile (`~/.config/google-chrome`) if another process (the user's physical GUI) is using it.
**Solutions:**
- **Manual Launch:** The user physically launches Chrome with `--remote-debugging-port=9222` from their GUI terminal. OmniRoute simply connects via `connectOverCDP`. This is the most authentic method for inheriting live cookies (like Tencent/hy3).
- **Ghost Profile Hijacking:** OmniRoute copies `Network/Cookies` and `Local Storage` to a `/tmp/ghost` profile at runtime. Playwright launches this ghost profile, inheriting the cookies without fighting the Singleton lock.

## 2. Escaping Sandboxed/Headless Execution Environments (The SSH Bypass)
When running OmniRoute as a daemon or containerized service, you lose access to `DISPLAY`, `XDG_RUNTIME_DIR`, and `DBUS_SESSION_BUS_ADDRESS`. Running `sudo -u user chrome` fails instantly on X11 hardware acceleration blocks.
**The SSH Bypass:** SSHing into `localhost` (`ssh merezarezaei@127.0.0.1`) forces the system's PAM module to authenticate a completely authentic login session. It naturally acquires the exact X11, Wayland, and DBus variables, allowing the headless script to flawlessly spawn GUI Chrome windows on the user's physical monitor.

## 3. Playwright Stealth & Human Mimicry
Traditional Playwright locators (`page.locator().fill()`) trigger standard automation tracking flags and can stall indefinitely on complex SPA frameworks.
**The Solution:**
- Always map raw OS-level `page.keyboard.type(text, { delay: rand })` instead of `.fill()`.
- Use random wait procedural delays (e.g. 30ms to 150ms between keystrokes).

## 4. DOM Mutation Streaming (No Network Intercepts)
Attempting to sniff AI streams by intercepting HTTP chunk responses via Playwright `route` is fragile and gets blocked by Cloudflare/Turnstile.
**The Solution:** Inject `MutationObserver` directly into the DOM (e.g. `setupDomStreamObserver`) to watch the element where the AI draws text. Yield the `textContent` diffs back to the Node process natively. This completely bypasses network scrutiny because it identical to a human watching a screen render.

---
*These discoveries paved the way to abstract generic web-version AI providers into A2A/ACP controllable web agents.*
