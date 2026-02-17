# PUBLISH.md — Publish Process

Run this as the final step after BALANCE and REVIEW have passed.

## Script

```bash
./scripts/publish.sh "summary of changes"
```

This handles everything: lint → typecheck → tests → commit → tag → push.

## What it does

1. `npx oxlint --fix src/` — lint (0 warnings required)
2. `npx tsc --noEmit` — type check
3. `bun test` — tests (skipped if bun not installed)
4. `git add -A && git commit` — commit with `v{version}: {summary}`
5. `git tag -a v{version}` — create annotated tag
6. `git push && git push --tags` — push everything

Version is read from `package.json` — bump it before running the script.

## Example

```bash
# Bump version first
npm version patch --no-git-tag-version
# Or manually edit package.json

# Then publish
./scripts/publish.sh "breach balance + agent prompt improvements"
```
