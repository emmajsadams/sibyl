# CLAUDE.md — Agent Rules for SIBYL

## Development Cycle

Four steps, repeating:

### 1. RUN
- Run a game with the current version: `bun run src/main.ts [config]`
- If no config provided, `generateRandomConfig()` creates random squads
- Training data auto-saves to `training/training-v{version}-{gameId}.json`
- Config auto-saves to `training/versions/v{version}-{gameId}.json`
- Logs capture everything — every move, ability, damage, decision

### 2. BALANCE
- Spawn a subagent to run the `BALANCE.md` process against the latest training data
- Subagent analyzes game flow, class balance, ability usage, agent behavior
- Fixes any issues found (stats, abilities, prompts, agent logic)
- Re-verifies after fixes
- Reports back with clear summary of findings and changes

### 3. REVIEW
- Spawn a subagent to run the `REVIEW.md` checklist against all changes
- Reviews correctness, consistency, simplicity, module boundaries, performance
- Fixes any issues found
- Reports back with clear summary of all code changes (what changed, why, in which files)

### 4. PUBLISH
- `npx oxlint --fix src/` — 0 warnings
- `bun test` — all tests pass
- `~/.bun/bin/bunx tsc --noEmit` — compiles clean
- Commit with clear message, push to GitHub
- Tag new version: `git tag -a v{version} -m "v{version}: {summary}"`
- Push tags: `git push --tags`

Pre-commit hook (husky) runs oxlint + tests + tsc automatically.

## Rules
- **Do NOT run full game simulations unless explicitly asked.**
- Use `npx tsc --noEmit` to verify changes compile.
- Test individual functions or small code snippets, not full games.
- Version in `package.json` must be bumped on any balance/logic change.

## Project
- Runtime: Bun + TypeScript
- Path: `~/code/sibyl/`
- CLI mode: `bun run src/main.ts <config> --cli` (uses Claude Pro subscription)
- API mode: `bun run src/main.ts <config>` (uses API credits)

## Key Directories
- `src/engine/` — game logic (no presentation)
- `src/agent/` — LLM agent (API + CLI backends)
- `src/training/` — Zod schemas + event recorder + random squad generation
- `src/cli/` — terminal renderer + input
- `src/types/` — shared types
- `training/versions/` — versioned game configs (committed)
- `training/` — generated training data (gitignored, except versions/)
- `runs/` — game logs (JSON + markdown)
