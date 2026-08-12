# OmniRoute Web-Provider Design Analysis

> Analysis of how OmniRoute's "web" providers (cookie/browser-replay LLM endpoints) work,
> their credential + rotation model, and the genuine design weaknesses — including a
> correction to the hypothesis that the failures are an access-token/refresh-token bug.

## TL;DR

- Web providers do **NOT** use OAuth `access_token` / `refresh_token`. That mental model
  (the "they only parse access token but for rotating needs refresh token" hypothesis) is
  **wrong for this class of provider**. They use a _freshness model_ built on a seed
  **session credential** (e.g. Gemini's `__Secure-1PSID*`, DeepSeek's `userToken`,
  Tencent's `hunyuan_user`/`hunyuan_token`) that is replayed in HTTP headers/cookies.
- The live `gemini-web` 500 ("Failed to load external module playwright") was an
  **environment break in the global install**, not a logic bug. The browser-backed
  providers cannot run at all when Playwright/Chromium is not importable, so rotation code
  never gets a chance to run.
- `deepseek-web` **does** have auto-refresh (`DeepSeekWebWithAutoRefreshExecutor`), which
  re-mints a short-lived `accessToken` from a long-lived `userToken` every
  `sessionRefreshInterval`. It only fails when the seed `userToken` itself is dead.

## 1. Two tiers of web provider

### Tier A — Cookie/HTTP replay (no browser)

Plain `fetch` with the operator's cookie jar injected as the `apiKey`/header.
`grep` shows: `tasw`, `kimi-web`, `grok-web`, `qwen-web`, `blackbox-web`,
`muse-spark-web`, `yuanbao-web`, `huggingchat`, `notion-web`, `perplexity-web`,
and our `tencent-aistudio-web`. No Playwright involved.

### Tier B — Browser-backed (Playwright / Chromium)

Verified imports of `chromium` / `browserBackedChat` / `browserPool`:

- `gemini-web.ts` — launches Chromium, injects cookies, harvests rotated `__Secure-1PSID*`
  via `context.cookies()` + `onCredentialsRefreshed`.
- `claude-web.ts` + `claude-web/browserTransport.ts` — Chromium + `claudeTurnstileSolver`
  for Turnstile.
- `duckduckgo-web.ts` — `browserBackedChat(...)`.
- `adobe-firefly` — `adobeFireflyChromeRuntime.ts` + `adobeFireflyBrowserLogin.ts`.
- `chatgpt-web-codex.ts` — browser worker.
- Shared warm pool: `open-sse/services/browserPool.ts` (one Chromium, per-provider
  contexts, 10-min TTL; `OMNIROUTE_BROWSER_POOL=off` disables; prefers `cloakbrowser`).

## 2. Credential + rotation model (no OAuth tokens)

Three distinct mechanisms:

1. **Reactive rotate-and-persist** — `ExecuteInput.onCredentialsRefreshed`
   (`open-sse/types.d.ts:76`), wired in `chatCore.ts:3498-3621` under a mutex. Used by
   `gemini-web` (`persistRotatedCookies`), `chatgpt-web`, `perplexity-web`, `codex`,
   `antigravity`, `gitlab`.
2. **Proactive auto-refresh executor** — `deepseek-web-with-auto-refresh.ts`:
   `setInterval` → `acquireAccessToken(this.currentUserToken)` re-mints a short-lived
   `accessToken`; on 401 it calls `refreshAndRetry` (lines 53-121). If the seed
   `userToken` is dead it throws `"Token expired — get a new userToken from DeepSeek
localStorage"` (no silent recovery).
3. **Proactive watchdog** — `autoRefreshDaemon.ts` (15-min tick) only _detects_ expiry;
   it does **not** auto-relogin by design.
4. **In-app login capture** — `inAppLoginService.ts` opens a browser to capture cookies +
   localStorage via `tokenExtractionConfig.ts`.

**Bottom line on the token hypothesis:** `credentials.refreshToken` is used ONLY by real
OAuth providers (qoder, kiro, antigravity, github, gitlab, xai, codex, ghe-copilot, trae,
grok-cli). Web-cookie executors store a session token, not access+refresh tokens. Rotation
for DeepSeek = `userToken` → `accessToken` re-mint; for Gemini = PSID replay + cookie
harvest. There is no "missing refresh token" bug — the seed session token is the
refresh-equivalent.

## 3. Genuine design mistakes / weak points

### A. Hard, un-degraded dependency on a working browser runtime

All Tier-B providers share one Chromium/Playwright dependency. When that dependency is
broken at the _module-load_ level (as on the live box: nested `playwright-core` missing
`browsers.json`), **every** browser provider dies with a cryptic
`500: Failed to load external module playwright` _before_ any request/rotation logic runs.
There is no startup health-check that fails fast with a clear message, and no automatic
fallback to HTTP. One shaky dependency = total outage for an entire model family.

### B. No graceful degradation for browser providers

`browserBackedChat.ts:423` documents an `httpBackedChat` lightweight alternative, but it is
opt-in and not wired for `gemini-web`/`claude-web`. A browser-env failure should ideally
fall back to HTTP replay where the provider supports it; today it just 500s.

### C. Duplicate, only-one-wired executor files (maintenance hazard)

`open-sse/executors/index.ts:142` maps the registry key `"deepseek-web"`
(`open-sse/config/providers/registry/deepseek/web/index.ts:7`) to
`new DeepSeekWebWithAutoRefreshExecutor()`, while a **separate** plain `deepseek-web.ts`
executor exists but is **never registered**. Two near-identical files where only one is
live is a classic edit-the-wrong-file trap and violates the "single source of truth" intent.
(`tasw` has the same smell: `tencent-aistudio-web.ts` is the one wired executor; any
future `tencent-aistudio-web-v2` would risk the same.)

### D. Seed-credential freshness is the operator's problem, with weak UX

Auto-refresh only works if the _seed_ session token is still valid. When it is dead, the
error surfaces to the end user ("get a new userToken from DeepSeek localStorage");
`autoRefreshDaemon` detects but does not recover. There is no in-band re-login and no
proactive warning in the dashboard until the provider circuit breaker trips. Rotation is
"best effort" and silently degrades.

### E. Whole-cookie-jar storage for Tier-A providers

Tier-A providers store the _entire_ cookie jar in one `apiKey` field. There is no
structured, per-cookie refresh; if any single cookie expires the operator must re-capture
the whole jar. (`tasw` inherits this: a single `hunyuan_user`/`hunyuan_token` pair, no
partial refresh.)

### F. Latency cost of per-call browser spin-up

`browserBackedChat.ts:753` notes ~10-25s per browser-backed call. Outside the 10-min
`browserPool` TTL there is no request-level session cache, so repeat calls pay the full
browser cost.

### G. (Strength — not a mistake) error sanitization is done right

Contrary to a possible leak concern: `gemini-web.ts` and `browserBackedChat.ts` route
errors through `sanitizeErrorMessage(...)` and `buildErrorBody(...)` (e.g.
`gemini-web.ts:666-678`, `browserBackedChat.ts:390,558`). Internal stack/path details are
not leaked to the client. `claude-web.ts:313-315` even forwards upstream `retry-after`. So
the security sanitization layer is correctly applied.

## 4. Why the live failures happened (corrected)

- **`gemini-web` 500** → Tier-B provider; Playwright module was not importable (corrupt
  nested `playwright-core`). Fixed by restoring `browsers.json`. Rotation code never ran
  because the browser never launched.
- **`deepseek-web` "failing"** → if it still fails after Playwright is fixed, it is the
  _seed_ `userToken` being dead/expired. The auto-refresh executor is present and correct;
  it cannot mint a token from a dead seed. This is a credential issue, not a missing
  refresh-token bug.

## 5. Suggested improvements (if acting on this)

1. Add a startup `browserPool` health probe that fails fast with a clear, actionable error
   ("Chromium unavailable — set OMNIROUTE_BROWSER_POOL=off or install browsers").
2. Wire an HTTP-replay fallback for browser providers that have a known cookie-replay path
   (including `gemini-web`/`claude-web` where the endpoint allows it).
3. Collapse duplicate executor files (e.g. merge `deepseek-web.ts` into
   `deepseek-web-with-auto-refresh.ts` and register one).
4. Surface seed-credential expiry in the dashboard _before_ requests fail (reuse
   `autoRefreshDaemon` signals).
5. Move Tier-A providers toward structured per-cookie storage so partial refresh is possible.
