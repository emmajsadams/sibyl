# CLAUDE.md — Agent Rules for SIBYL

## Game Runs
- **Do NOT run full game simulations unless explicitly asked.**
- Use `npx tsc --noEmit` to verify changes compile.
- Test individual functions or small code snippets, not full games.

## Commit Workflow
1. Before every commit, run the full `REVIEW.md` checklist against your changes
2. Fix anything that fails the review
3. `~/.bun/bin/bunx tsc --noEmit` must pass
4. Commit with a clear message, then push

## Project
- Runtime: Bun + TypeScript
- Path: `~/code/sibyl/`
- CLI mode: `bun run src/main.ts <config> --cli` (uses Claude Pro subscription)
- API mode: `bun run src/main.ts <config>` (uses API credits)
- Version tracked in `package.json` — bump on any balance/logic change

## Key Directories
- `src/engine/` — game logic (no presentation)
- `src/agent/` — LLM agent (API + CLI backends)
- `src/training/` — Zod schemas + event recorder
- `src/cli/` — terminal renderer + input
- `configs/` — game config JSON files
- `training/` — generated training data (gitignored)
- `runs/` — game logs (JSON + markdown)
