# Project Backlog

## Progress

- [x] Initial `.brain/` setup & PITA protocol configuration @brain-dev
- [x] Architecture plan & endpoint reverse-engineering for `tencent-aistudio-web` (`aistudio.tencent.ai`)
- [x] Task 1: Register `tencent-aistudio-web` in `src/shared/constants/providers/web-cookie.ts` and `open-sse/config/providers/registry/tencent-aistudio-web/index.ts`
- [x] Task 2: Implement executor `open-sse/executors/tencent-aistudio-web.ts` for `aistudio.tencent.ai` API & SSE parsing
- [x] Task 3: Wire executor in `open-sse/executors/index.ts` & update provider aliases
- [x] Task 4: Create unit tests in `tests/unit/tencent-aistudio-web.test.ts` for registry & executor validation

## Pending Tasks (3D Media Protocol & Generation Endpoint)

- [ ] Task 5: Design & add 3D generation route `src/app/api/v1/3d/generations/route.ts` & registry `open-sse/config/threeDRegistry.ts`
- [ ] Task 6: Add 3D models endpoint support & integration tests
