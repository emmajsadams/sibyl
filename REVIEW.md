# REVIEW.md — Self-Review Prompt

Run this review on all staged/changed files before committing. Fix issues before you commit.

## Process

1. `git diff --stat` to see what changed
2. `git diff` to read the actual changes
3. Review against every checklist item below
4. Fix anything that fails
5. `~/.bun/bin/bunx tsc --noEmit` — must pass
6. Only then commit and push

## Checklist

### Correctness
- [ ] No logic bugs — trace the happy path and edge cases mentally
- [ ] No off-by-one errors in loops, ranges, grid math
- [ ] Error cases handled — what happens when input is unexpected?
- [ ] Types are accurate — no `any` unless truly unavoidable (comment why)
- [ ] Zod schemas match the runtime data they validate

### Consistency
- [ ] Naming matches existing conventions (camelCase functions, PascalCase types, UPPER_SNAKE constants)
- [ ] New code follows the same patterns as adjacent code (e.g. if other tools return `{ pos: [x,y] }`, don't return `{ position: {x,y} }`)
- [ ] Imports are from the right barrel files — don't bypass `index.ts` re-exports
- [ ] File placement matches the directory structure (`engine/` = logic, `agent/` = LLM, `training/` = data, `cli/` = presentation)

### Simplicity
- [ ] No dead code — remove unused imports, functions, variables
- [ ] No duplication — if you wrote the same logic twice, extract it
- [ ] Functions do one thing — if a function does two unrelated things, split it
- [ ] No premature abstraction — don't add indirection that has only one call site
- [ ] Prefer flat over nested — early returns over deep `if/else` chains

### Boundaries
- [ ] Engine (`src/engine/`) has NO imports from `agent/`, `cli/`, or `training/` — it's pure game logic
- [ ] Agent (`src/agent/`) doesn't import from `cli/`
- [ ] Training emitter is the ONLY bridge between engine and training — engine calls `emit()`, never imports recorder
- [ ] Types in `src/types/` are shared; module-specific types stay in their module

### Performance & Safety
- [ ] No synchronous file I/O in hot paths (per-unit-turn game loop)
- [ ] LLM calls have bounded `max_tokens`
- [ ] JSON.parse wrapped in try/catch where input is untrusted
- [ ] No secrets or API keys in committed code

### Documentation
- [ ] Public functions have a brief comment if their purpose isn't obvious from the name
- [ ] TRAINING.md updated if training events/schema changed
- [ ] CLAUDE.md updated if project conventions changed
- [ ] Version bumped in package.json if game balance or mechanics changed
