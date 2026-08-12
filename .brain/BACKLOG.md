# Project Backlog

## Progress

- [x] Initial `.brain/` setup & PITA protocol configuration @brain-dev
- [x] Architecture plan & endpoint reverse-engineering for `tencent-aistudio-web` (`aistudio.tencent.ai`)
- [x] Task 1: Register `tencent-aistudio-web` in `src/shared/constants/providers/web-cookie.ts` and `open-sse/config/providers/registry/tencent-aistudio-web/index.ts`
- [x] Task 2: Implement executor `open-sse/executors/tencent-aistudio-web.ts` for `aistudio.tencent.ai` API & SSE parsing
- [x] Task 3: Wire executor in `open-sse/executors/index.ts` & update provider aliases
- [x] Task 4: Create unit tests in `tests/unit/tencent-aistudio-web.test.ts` for registry & executor validation
- [x] Task 5 (DONE via PR): Clean upstream submission of `tasw` provider — fork + PR opened

## Session Log (2026-08-12)

**Goal:** Add `tencent-aistudio-web` (alias `tasw`) cookie provider to OmniRoute, keep `.brain/` private, and submit upstream.

**What happened:**

1. Built provider on `brain-dev` (registry + executor + constants + test). Initial commit `7407078c7` was BROKEN (wrong executor API usage, missing import in `providers/index.ts`, test import typo).
2. Created isolated worktree `.claude/worktrees/feat-tencent-aistudio-web` off `origin/release/v3.8.50`. Cherry-picked ONLY provider files (excluded `.brain/`). Fixed all bugs there; unit test PASSES.
3. `MeRezaRezaei/OmniRoute` was a standalone mirror (NOT a fork of `diegosouzapw/OmniRoute`), so `gh pr create` failed with "No commits between". Created proper fork via `gh repo fork` → **`MeRezaRezaei/OmniRoute-1`**. Pushed branch, opened PR.
4. **PR #10174** opened against `release/v3.8.50`: https://github.com/diegosouzapw/OmniRoute/pull/10174
5. Base branch `release/v3.8.50` is RED (upstream issue #9985) — added `⚠️ base-red inherited: #9985` to PR body per project rules. Did NOT attempt to fix base-red inside the branch.
6. Live OmniRoute server (pid 484428) crashed with `500: Failed to load external module playwright` — root cause was a corrupt nested `playwright-core` (missing `browsers.json`) in the GLOBALLY installed package `/usr/local/lib/node_modules/omniroute/dist`. Fixed by copying `browsers.json` from top-level `playwright-core`. Crash resolved (endpoint now returns 401 = auth required, not 500). This was unrelated to our provider code.

**Private branch hygiene:** `.brain/` was NEVER pushed to the fork/PR. The PR branch contains only provider source + test.

## Pending Tasks (3D Media Protocol & Generation Endpoint)

- [ ] Task 6: Design & add 3D generation route `src/app/api/v1/3d/generations/route.ts` & registry `open-sse/config/threeDRegistry.ts`
- [ ] Task 7: Add 3D models endpoint support & integration tests

## Session Log (2026-08-12, from-source build + web-provider investigation)

**Goal:** Get our fixed version (brain-dev) running from source, usable for free web providers (DeepSeek, Kimi, hy3). Investigate web-provider login behavior.

**What happened:**

1. From-source build against red base release/v3.8.50 (#9985) surfaced FOUR compile errors, all base-red in files we never touched: catalogCache.ts missing __setCatalogStaleWhileRevalidateMsForTest export, modelSelectModalHelpers.ts parse error (missing '}'), videoGeneration.ts duplicate handleFalVideoGeneration import, migrations/143_job_registry.sql collision. Borrowed upstream fixes: commits 16088dc49, 3facc3882, 6bc82aa80 (videoGeneration), plus git rm of the duplicate migration. Build #4 succeeded (1754 pages).
2. Ran brain-dev on PORT=20133 with ISOLATED DATA_DIR=/tmp/opencode/brain-dev-data (avoids 'Migration version collision' against the shared global live sqlite at ~/.omniroute/storage.sqlite). Generated secrets inline (JWT_SECRET, API_KEY_SECRET, INITIAL_PASSWORD=CHANGEME). Server booted, login POST worked, /v1/models returned 233 models. The managed pty hit its 600s timeout and STOPPED (exit 0) — must restart with a longer timeout to keep it up.
3. Web-provider login investigation: in-app browser login exists ONLY for providers in TOKEN_EXTRACTION_CONFIGS (claude-web, chatgpt-web, gemini-web, grok-web, perplexity-web, deepseek-web, qwen-web). deepseek-web opens a tab but relies on Playwright and is unreliable here. kimi-web and hy3 have NO config => no tab. Reliable method for ALL web providers: log into the site in your own browser, copy the session cookie (DeepSeek=user-token, Kimi=its auth cookie), paste into the provider connection API Key field (authType apikey/bearer).
4. hy3 is NOT a registered provider in OmniRoute (no registry dir, grep returns 0). User likely meant a different free provider; qwen-web IS registered + has in-app login.

**Our genuine fixes (to upstream as separate PRs):** deepseek-web auto-refresh retry-loop fix (5da800d82), tasw provider (PR #10174, fork MeRezaRezaei/OmniRoute-1). The base-red fixes are upstream's work, borrowed into brain-dev only to unblock the local build; NOT claimed as ours.

**Open:** (a) restart the 20133 server with a longer timeout; (b) decide whether to add hy3 or substitute a registered provider (qwen-web recommended); (c) create an API key for the user once server is up.
