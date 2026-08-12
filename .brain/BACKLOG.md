# Project Backlog

## Progress

- [x] Initial `.brain/` setup & PITA protocol configuration @brain-dev
- [x] Architecture plan & endpoint reverse-engineering for `tencent-aistudio-web` (`aistudio.tencent.ai`)

## Pending Tasks (Tencent AI Studio Web Provider)

- [ ] Task 1: Register `tencent-aistudio-web` in `src/shared/constants/providers/web-cookie.ts` and `open-sse/config/providers/registry/tencent-aistudio-web/index.ts`
- [ ] Task 2: Implement executor `open-sse/executors/tencent-aistudio-web.ts` for `aistudio.tencent.ai` API & SSE parsing
- [ ] Task 3: Wire executor in `open-sse/executors/index.ts` & update provider aliases
- [ ] Task 4: Create unit tests in `tests/unit/tencent-aistudio-web.test.ts` for registry & executor validation
