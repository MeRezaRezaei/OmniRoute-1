# PITA (Pain In The Ass) Autonomous Execution Protocol

## Execution Loop
1. **Context Loading**: Read `.brain/context.json` and `.brain/BACKLOG.md` to identify active priorities.
2. **Task Selection**: Select the highest priority unblocked task from `.brain/BACKLOG.md`.
3. **Execution**: Implement changes in dedicated git branches/worktrees.
4. **Verification**: Run unit/integration tests and linters.
5. **State Update**: Record completion in `.brain/BACKLOG.md` and append any factual learnings to `.brain/memories.jsonl`.
6. **Commit**: Commit state changes alongside code changes.
