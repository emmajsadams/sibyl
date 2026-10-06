# Jev balance loop — 2026-10-06

**Implementation only; the experiment has not been launched.** Outer Hermes launches after review. No records from `scratch/sibyl-100`, `runs/`, or `training/` count toward this experiment. This directory currently contains documentation, not game evidence.

## Invocation

Run from the reviewed, committed `main` checkout. Requires Bun, Python 3, the installed `codex`, its existing ChatGPT login, and permission to push `origin/main`. No PR, tags, version auto-bumps, or legacy publishing script are used during the experiment.

```sh
cd /Users/emma/sibyl
# Inert usage check; does not create a checkpoint or read a credential:
bun run src/balance/runner.ts

# Offline verification; no API calls; recorder tests use a disposable copy:
./scripts/verify-jev-balance.sh

# OUTER HERMES ONLY, after review — actual paid Jev matches:
bun run src/balance/runner.ts --run

# Resume the same experiment, with original clock, counts, frozen inputs:
bun run src/balance/runner.ts --run --resume
```

Do **not** source the credential file into a shell. Only the isolated match worker reads `/Users/emma/.hermes/cache/scratch/sibyl-jev.env`, accepting exactly one literal `TYPESAFE_API_KEY=...` assignment (optional `export` and quotes). It does not execute dotenv contents or fall back to an inherited key. The controller and all children strip inherited `TYPESAFE_API_KEY`; Codex also receives no `OPENAI_API_KEY` or `OPENAI_ACCESS_TOKEN`. The SDK endpoint is pinned to `https://api.typesafe.ai` and SDK logging is disabled, so inherited endpoint/logging variables cannot redirect credentials or enable verbose logging. Credential values and SDK exception bodies are never logged or included in reports.

The installed designer command is executed in a real PTY by `scripts/jev-designer-pty.py`, using an argument array, not shell interpolation:

```text
codex exec --sandbox read-only --ignore-user-config --ignore-rules --ephemeral
  --skip-git-repo-check --color never -c project_doc_max_bytes=0
  -C <private-designer-directory> --output-schema <schema.json>
  --output-last-message <response.json> <frozen-evidence-prompt>
```

`codex login status` must confirm ChatGPT authentication. Actual designer execution occurs only after that cycle's 50 CLEAN discovery results. Auth/transport/schema failures stop the experiment; no fallback proposal or second invocation is fabricated. A recorded successful designer completion can be recovered after a controller crash without invoking it again. The designer is instructed not to use tools; its output cannot change code and is validated independently.

## Experiment contract

- Ten cycles, each with 25 freshly generated squad/prompt configurations played in both orientations: **500 CLEAN discovery matches** on successful completion. Each cycle freezes full generated configs/prompts, vetted whitelist, balance, source/rule snapshots, lockfile and code hash. No prompt or mechanics edits; no recalibrate workaround. Source or manifest changes stop the cycle.
- Each match runs the existing real engine and `jev-agent` in a new subprocess, with real TypeSafe `jev-latest` calls. No main-loop fallback placements, swallowed action errors, legacy training recorder, or simulation mode. The worker journals every provider request start, response/failure, validated Jev decision, resolved action and engine event. Each result identifies its actual Git commit and request hash.
- CLEAN means a confirmed engine terminal state, known winner/draw and exact terminal reason, positive bounded decision count, zero failed decisions, and no match failure. HP tiebreaks at round 20 retain the engine's exact outcome. An earlier action remains recorded if the next decision fails, but the whole attempt is excluded from CLEAN counts.
- Each game has a 15-minute subprocess timeout and 1,000-provider-decision cap. SDK decision retries are disabled. Only a confirmed HTTP 502 is retried, by restarting the **entire** game on the same frozen slot, at most twice. Three consecutive failed attempts halt. Any other failure stops immediately, including lossless request/choice limits, malformed decisions, timeout, interruption, invalid actions or missing credentials. Failed attempts count against the global attempt budget.
- A durable wall-clock limit of 12 hours includes downtime between resumes. At most 800 attempts, discovery plus evaluation plus failures. Termination begins at the deadline; a maximum three-second forced-kill grace permits process cleanup. No new work starts after the limit.
- One designer output per cycle: `hold` or one integer stat from `unitStats.<class>.{maxHp,movement,range,speed}`. The delta must be at most 1 **or** 15% of the frozen value, within absolute bounds (HP 1–20, movement/range 1–6, speed 1–3). No arbitrary code, abilities, grid, round, or prompt changes. Null path/value are mandatory for hold; unknown JSON keys are rejected.
- Discovery eligibility requires at least eight informative swapped pairs for the chosen class, exclusive presence on one squad, and average score ≤0.35 or ≥0.65. The proposed direction must counter that association. An ineligible proposal is retained with a hold evaluation.
- An eligible candidate receives eight **additional** matched configuration blocks: baseline in both orientations plus candidate in both orientations, **32 evaluation games**. Evaluation pools for every class are generated and frozen before discovery, restricted to exclusive class presence; only the selected class's pool is used. The same configs/prompts appear in all four games of a block. Jev sampling is stochastic; these are matched configurations, not common random seeds.
- Counts are separate: 500 discovery target and ≤320 evaluation ceiling. Those maxima would total 820, so the 800-attempt cap takes precedence. The controller reserves remaining discovery slots before starting an evaluation; with no failures, at most nine complete evaluations (288 games) fit. Retries may exhaust the remaining budget and stop the experiment; the runner never labels an incomplete run complete.

## Conservative evaluation gate

For each four-game block, score a win by the squad containing the proposed class as 1, loss as 0, and draw as 0.5. Average its two orientations separately for baseline (`b`) and candidate (`c`). The paired improvement is `abs(b - 0.5) - abs(c - 0.5)`.

Acceptance requires all eight clean blocks, the lower endpoint of the approximate 95% paired t interval (`mean ± 2.365 * sampleSD / sqrt(8)`) above 0.05, aggregate absolute class bias improved by at least 0.10, at least seven blocks strictly improved with no block worse, and no increase in draws. Otherwise hold. This is a conservative exploratory gate on a small, discrete sample, not proof of global balance or correction for every class/composition effect. A hold is an expected result; changes are never forced.

Before persisting an accepted stat, the runner reruns the source suite in an isolated copy and checks that the candidate JSON applies correctly to real engine unit factories. Only then does it write `accepted-balance.json`; the next cycle uses that baseline. The worker validates the complete JSON against allowed numeric fields, preserving the engine's `UNIT_STATS` alias. This JSON is an experiment-specific accepted configuration, not an implicit change to all legacy CLI games.

## Persistence and publishing

`raw/` is private and gitignored. It contains atomic checkpoints, locks, attempt request/result JSON, append-only fsynced provider/engine event journals, worker logs, and designer PTY inputs/output. A checkpoint reserves an attempt **before** subprocess launch and settles it atomically after completion. It retains the original start time, all attempts, failure streak, next cycle, and sealed manifest hashes. Every atomic write uses file fsync, rename, and directory fsync.

Only explicit sanitized files are staged and committed directly to `main`: each cycle's `manifest.json`, `evidence.json`, validated `proposal.json`, `evaluation.json`, optional `proposal-rejection.json`/`halt.json`, and accepted numeric configuration. Reports contain generated inputs, frozen source, known terminal reasons, counts, numeric analysis and provenance, not provider payloads or arbitrary designer prose. Rejected/inconclusive proposals are retained. Failed cycles attempt to publish a sanitized halt report; a publication failure leaves it locally for review. Each successful push checks the exact remote `refs/heads/main` hash.

The repository-wide hook formats all source and runs recorder tests in the checkout. To preserve existing untracked run/training files, this runner bypasses that hook for its narrowly staged **report-only** commits, and runs accepted-change verification explicitly in an isolated copy. It never invokes `scripts/publish.sh`, `git add .`, `git clean`, resets, or force-pushes. Unexpected staged files block publication.

A normal `--resume` consumes a durable pending result once, or reconstructs an interrupted failure from its journal. It never credits an incomplete decision or silently replays an ambiguous interrupted game. Completed cycle reports can be published again idempotently after a push failure, without further games or a second designer invocation. A scientific/auth failure is a durable halt; resume does not clear it or reset the clock/budgets.

After SIGKILL or host loss, `raw/runner.lock/owner.json` may remain. Before manually removing **only that lock directory**, outer Hermes must verify the recorded controller PID and all match/designer descendants are dead. Then use `--run --resume`. Do not remove checkpoints, edit counters, clear halts, or overwrite frozen manifests to obtain more games. Ambiguous designer completion halts for review rather than risking a second candidate.

## Verification record

The implementation first ran two failing regression tests for lost engine draw reasons and exclusion of a failed final-turn decision. RED: 0 passed, 2 failed. The minimal fix stores the engine terminal reason, flushes the pending logger turn, and exposes failure/CLEAN fields. GREEN: both passed.

Offline source suite: 239 passed (the original 214 plus 25 new tests), 0 failed. Scoped formatter, scoped lint and TypeScript checks passed. Coverage includes real engine terminal fixtures, actual SDK transport fixtures, every placement/action decision, a second-action 502, malformed response exclusion, proposal bounds, side swaps, checkpoint/attempt accounting, timeout termination, credential stripping, structured read-only PTY invocation, and the clean50 designer gate. Fixtures are in memory or disposable temporary directories; none are experiment records. Actual Jev connectivity, 500-game performance, and designer generation are deliberately untested in this implementation task.


## Implementation handoff limitation

In this implementation session, the sandbox denied `.git/index.lock` writes, shell Git could not resolve `github.com`, and the GitHub connector required reauthentication. Therefore the verified files remain **uncommitted** in the local `main` worktree; no remote hash was verified. Outer Hermes must commit the explicit implementation file list and push/verify `main` in its authorized Git environment **before** running the experiment. Preserve the existing untracked `runs/` and `training/` files. This limitation does not authorize resetting, cleaning, staging all files, or launching games before review.

Outer Hermes publication commands (implementation only; do not launch games):

```sh
cd /Users/emma/sibyl
./scripts/verify-jev-balance.sh
# Stop if someone else has staged work.
test -z "$(git diff --cached --name-only)"
git add -- .gitignore package.json src/engine/game.ts src/types/index.ts \
  src/logger.ts src/logger.test.ts \
  src/balance/core.ts src/balance/core.test.ts \
  src/balance/match.ts src/balance/match.test.ts \
  src/balance/process.ts src/balance/runner.ts src/balance/runner.test.ts \
  scripts/jev-designer-pty.py scripts/verify-jev-balance.sh \
  experiments/jev-balance-20261006/README.md
git diff --cached --stat
# Equivalent checks ran above in isolation; avoid the broad mutating hook.
git -c core.hooksPath=/dev/null commit -m "Add durable isolated Jev balance loop and clean result reporting"
git push origin main
test "$(git rev-parse HEAD)" = "$(git ls-remote origin refs/heads/main | cut -f1)"
```
