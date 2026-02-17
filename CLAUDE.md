# CLAUDE.md — Agent Rules for SIBYL

## Development Cycle

Four steps, repeating:

### 1. RUN
- Run a game with the current version: `npx tsx src/main.ts --auto [config]`
- Uses Claude CLI (subscription) by default. Pass `--api` to use Anthropic API credits instead.
- `--auto` skips interactive squad selection and uses random config (required for automated/subagent runs)
- If no config provided, `generateRandomConfig()` creates random squads
- Training data auto-saves to `training/training-v{version}-{gameId}.json`
- Config auto-saves to `training/versions/v{version}-{gameId}.json`
- Logs capture everything — every move, ability, damage, decision

### 2. BALANCE
- Spawn a subagent to run the `skills/BALANCE.md` process against the latest training data
- Subagent analyzes game flow, class balance, ability usage, agent behavior
- Fixes any issues found (stats, abilities, prompts, agent logic)
- Re-verifies after fixes
- Reports back with clear summary of findings and changes

### 3. REVIEW
- Spawn a subagent to run the `skills/REVIEW.md` checklist against all changes
- Reviews correctness, consistency, simplicity, module boundaries, performance
- Fixes any issues found
- Reports back with clear summary of all code changes (what changed, why, in which files)

### 4. PUBLISH
- Run `./scripts/publish.sh "summary of changes"` (see `skills/PUBLISH.md`)
- Handles: lint → typecheck → tests → commit → tag → push
- Version is read from `package.json` — bump it before running
- Reports back with version number and summary

Pre-commit hook (husky) runs oxlint + tests + tsc automatically.

## Documentation Map

| File | Purpose | Used by |
|---|---|---|
| `CLAUDE.md` | Dev cycle, rules, project structure | Claude (auto-loaded as system prompt) |
| `SPEC.md` | Game design spec — mechanics, classes, abilities | Reference for humans + Claude |
| `skills/BALANCE.md` | Balance review checklist — subagent prompt | BALANCE step subagent |
| `skills/REVIEW.md` | Code review checklist — subagent prompt | REVIEW step subagent |
| `skills/PUBLISH.md` | Publish checklist — subagent prompt | PUBLISH step subagent |
| `README.md` | Project overview + training data docs | Humans / GitHub |

CLAUDE.md orchestrates. `skills/` contains subagent prompts (read by spawned agents during their respective steps). SPEC.md is the source of truth for game design.

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
