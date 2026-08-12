# Project Brain (`.brain/`)

This directory maintains the version-controlled project state, task backlog, and project context for autonomous AI agent operation.

## Structure
- `THE_PROTOCOL.md`: Operating procedures and the PITA execution loop.
- `context.json`: Project metadata, active focus, and context settings.
- `memories.jsonl`: Project-specific decisions and factual memory logs.
- `BACKLOG.md`: Task backlog, priorities, and implementation state.

## Memory Separation
- **Project State (Git)**: Dynamic specs, tasks, architecture notes, and progress logs stay in `.brain/`.
- **Methodological Memory (Nowledge Mem)**: Cross-project patterns, generic how-tos, and agent mindsets are stored in global AI memory.
