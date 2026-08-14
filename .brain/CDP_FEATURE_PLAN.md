# CDP Chrome-Control Feature — Plan

Date: 2026-08-14
Branch: feat/cdp-remote-login
Status: PLANNING

## Goal (Reza, verbatim intent)

The CDP feature is not complete — only backend exists. Full feature:
1. OmniRoute controls the user's REAL Chrome + a specific user profile via CDP to read cookies.
2. Opens a login tab INSIDE the user's own profile (real window), cookies persist back to that profile.
3. Binds web-provider request execution to ONLY the CDP-controlled Chrome so upstream sees genuine
   browser traffic (real fingerprint/TLS/cookies/IP) and "won't notice anything is wrong".

## GAP A — Profile↔identity↔provider matching (the one Reza explicitly flagged)

User is logged into OmniRoute dashboard (identity = OmniRoute API key/session, unrelated to Chrome).
Chrome profile holds OAuth/session cookies for ALL the user's accounts. OmniRoute must pick the RIGHT
profile to open the tab in and to bind execution to.

Open problem: OmniRoute dashboard identity (API key) has NO link to a Chrome profile. Can't infer from
auth alone. **Decision: explicit user mapping + auto-detect cookies.**

Design:
- Auto-detect: for each discovered Chrome profile (listChromeProfiles), scan which web-provider domains
  it holds session cookies for. Cookie fingerprints per provider come from TOKEN_EXTRACTION_CONFIGS
  (tokenSources with type "cookie", name+domain) + executor baseUrl domains.
- Result: `providerId → { profileDir, cookieNames[] }` availability matrix. Dashboard shows "this profile
  has Claude + Gemini sessions" so the user picks the right one confidently.
- Persist the chosen mapping in the provider connection row (providerSpecificData.cdpProfileDir) so
  execution binding reuses the same profile without re-asking.
- No identity match to dashboard user: the mapping is chosen by the OPERATOR on the local machine where
  Chrome lives. Remote/VPS operators have no local Chrome — feature is LOCAL-ONLY (loopback). Enforce
  via isLocalOnlyPath() on routes (Hard Rule #15/#17).

## GAP B — Attach vs relaunch (SingletonLock)

Chromium: "browsers do not allow launching multiple instances with the same User Data Directory."
- If Chrome is already running on that profile → our `launchCdpBrowser` spawn fails (SingletonLock).
- Chrome policy (2024+) also discourages automating the DEFAULT profile directly.

Decision (two modes):
- **Attach mode (preferred)**: if a debuggable Chrome is already running (has `--remote-debugging-port`),
  `connectOverCDP` attaches to it. Use `browser.contexts()[0]` (default context = real profile).
- **Launch mode**: spawn Chrome with `--user-data-dir=<profile>` + `--profile-directory=<dir>` +
  `--remote-debugging-port=0`. Requires the profile NOT already open. Operator must close Chrome first,
  OR we copy the profile dir to a throwaway automation dir (safe default: copy profile, avoids locking +
  Chrome-policy default-profile issues). Copy profile → no SingletonLock, no policy break; cookies are
  snapshotted but fresh logins write to the copy, not the live profile.

Tradeoff: attach = live profile, best stealth, but needs debuggable Chrome. Copy-launch = works even with
Chrome open, but diverges from live profile. **Default: prefer attach; fall back to copy-launch.**

connectOverCDP confirmed: `browser.contexts()[0]` IS the persistent default context (real profile
cookies + localStorage). `noDefaults: true` prevents Playwright overrides interfering with a daily-driver
browser. `newContext()` is ISOLATED/non-persistent — current inAppLoginService uses newContext (BUG for
the "open tab in user's profile" goal).

## GAP D — Cookie read mechanism

- `page.context().cookies()` / `context.cookies(urls)` returns real cookies on default context. Enough for
  extraction (current code path). Persists because default context writes to profile on disk.
- Keep current `context.cookies()` polling; just switch to `browser.contexts()[0]`, not newContext.
- Do NOT use CDP Network.getAllCookies unless needed (Network domain not enabled by default).

## GAP E — Execution binding (stealth: "providers won't notice")

Web providers currently send `fetch()` from Node (datacenter IP, no browser fingerprint). To bind execution
to the CDP Chrome:
- **Option A (recommended)**: in-page fetch via `page.evaluate(() => fetch(url, init))` on a page in the
  default context. Upstream sees REAL browser TLS/fingerprint/cookies/IP. For SSE streaming, bridge
  chunks via `page.exposeFunction` pushing chunk → Node ReadableStream. More work but best stealth.
- Option B: CDP Network domain (`Network.enable` + intercept) — byte-accurate streaming, but doesn't run
  page JS, weaker fingerprint, more complex.
- Decision: **Option A**. Non-stream JSON → single evaluate. Stream → exposeFunction chunk bridge.
- Execution binding is opt-in per provider (flag: WEB_PROVIDER_CDP_BIND, default off) so existing
  fetch-based web providers keep working until operator opts a provider into CDP binding.

## GAP F — Security

- CDP ws endpoint binds `--remote-debugging-address=127.0.0.1` (loopback only). Never 0.0.0.0.
- All CDP routes + any new execution route MUST be LOCAL_ONLY (isLocalOnlyPath). Loopback enforcement
  before auth. Hard Rule #15/#17.
- Reject if a CDP endpoint is reachable on a non-loopback address.

## Research sources
- Playwright docs (context7 /microsoft/playwright): connectOverCDP, contexts()[0]=default persistent
  context, noDefaults:true for daily-driver attach, newContext()=isolated, launchPersistentContext
  Chrome-policy default-profile warning, SingletonLock "same User Data Directory" restriction.
- Memory (nowledge_mem): web providers = cookie-replay (fetch, webCookieAuth) tier A vs browser-backed
  (Playwright browserPool) tier B; session stickiness required for web SSE (disableSessionStickiness must
  stay false).

## Implementation order
1. Pillar 1: persistent CDP controller (attach/launch/copy, reconnect, default-context access). NEW
   `open-sse/services/cdpController.ts`.
2. Pillar 2: login opens tab in default context (browser.contexts()[0]); cookies persist. FIX
   inAppLoginService runBrowserLogin + add noDefaults, default-context page.
3. Pillar 3: execution binding — in-page fetch executor (evaluate + exposeFunction SSE bridge). NEW
   `open-sse/services/cdpFetchExecutor.ts`; hook opt-in in web executors.
4. Dashboard: profile→provider availability matrix + CDP-bind toggle + mapping persistence.
5. Routes: local-only guard, profile cookies scan endpoint.
6. Tests: tests/unit/cdpController.test.ts, cdpFetchExecutor.test.ts, login-default-context regression.

## Pre-existing compile errors in partial backend (must fix in Pillar 2)
- inAppLoginService.ts:211-212 — `options` name not in scope (2 refs). Check runBrowserLogin signature.
- chromeProfiles.ts:160 — `.browser` doesn't exist on Playwright `Browser` type (returns wrong thing from launchCdpBrowser).
- src/app/api/providers/[id]/login/route.ts:242 — `profileDir`/`forceCdp` shorthand refs missing declarations (destructure bug).

## Progress log
- 2026-08-14: research gaps A/B/D/E/F; wrote this plan; found 3 pre-existing compile errors. Next: Pillar 1.
- 2026-08-14: Pillar 1 (cdpController persistent attach/launch/copy/reconnect + default-context) committed in 25b882ff8.
- 2026-08-14: Pillar 2 login-default-context fixed — cdpLoginOrchestrator opens tab in default context,
  verifies in a separate tab, and keeps the CDP Chrome alive. login route uses orchestrator when
  profileDir/forceCdp set; 3 pre-existing compile errors fixed. Committed in eec6406bc.
- 2026-08-14: Pillar 5 routes + security — /login, /cdp, /cdp-profiles, /login-sessions all LOCAL_ONLY
  (routeGuard + spawnCapablePrefixes), loopback enforcement before auth (Hard Rules #15/#17). Committed.
- 2026-08-14: Pillar 6 tests — cdpLoginOrchestrator registry + route-guard local-only classification tests.
- REMAINING: Pillar 3 execution binding (cdpFetchExecutor, Option A in-page fetch + exposeFunction SSE
  bridge, WEB_PROVIDER_CDP_BIND flag default off). Pillar 4 dashboard profile→provider matrix UI.
- REMAINING: openapi.yaml / docs update for the new login-sessions + cdp-profiles endpoints.
## Progress log
- 2026-08-14 — Pillar 1+2 done (cdpController.ts persistent controller; inAppLoginService default-context profile-persistent login; fixed 3 compile errors + literal REDACTED placeholder in login route).
- 2026-08-14 — Gap A runtime orchestration done (cdpLoginOrchestrator.ts: requestId↔tab registry, in-page hook injection, verify-in-separate-tab, selective cleanup keeping CDP Chrome alive). Local-only routes: /api/providers/login-sessions (GET/DELETE). Route guards: 4 CDP regexes in LOCAL_ONLY_API_PATTERNS + 3 in SPAWN_CAPABLE_PATTERNS.
- 2026-08-14 — Pillar 3 (execution binding) DONE: open-sse/services/cdpFetchExecutor.ts (cdpFetch whole-body + cdpFetchStream SSE via exposeFunction→Node Readable bridge; composes cdpController default-context; opt-in via WEB_PROVIDER_CDP_BIND flag default off; errors via sanitizeErrorMessage). Tests: tests/unit/cdpFetchExecutor.test.ts (4 gating/reject cases). tsc clean; lint clean.
- REMAINING: Pillar 4 dashboard profile→provider matrix UI + mapping persistence; openapi/docs; VPS live test of attach+launch+in-page fetch.
