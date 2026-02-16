# PUBLISH.md — Publish Process

Run this as the final step after BALANCE and REVIEW have passed.

## Process

1. `npx oxlint --fix src/` — must show 0 warnings
2. `~/.bun/bin/bun test` — all tests must pass
3. `~/.bun/bin/bunx tsc --noEmit` — must compile clean
4. Bump version in `package.json` if not already done
5. `git add -A`
6. `git commit -m "v{version}: {summary of changes}"`
7. `git tag -a v{version} -m "v{version}: {summary}"`
8. `git push && git push --tags`
9. Output a clear summary: version number, what changed, tag created
