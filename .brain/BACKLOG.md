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
