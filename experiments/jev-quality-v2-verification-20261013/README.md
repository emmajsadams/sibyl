# Verification record — methodology v2

## Executed, not simulated results

- Final implementation/analysis commit before this record: `e35ef5afae933d7db263835ea8105e7e09ac6b45`.
- `sh scripts/verify-jev-balance.sh`: **269 passed, 0 failed**, 18 source test files; scoped formatter clean, lint **0 warnings / 0 errors**, `tsc --noEmit` exit 0. Tests run in a disposable copy. Source tests include actual engine/recorder fixtures, strict test-only designer fixtures, accepted/rejected/inconclusive gates, three bounded real-engine/provider-stub failures, and an offline decision-stub end-to-end evaluation of 18 engine games (2 discovery + 16 holdout) with partial-block and final-look crash recovery. These are **offline tests**, not live Jev results.
- Additional offline numeric probe installed `abilities.patch.healAmount = 2`, exercised real-engine Patch on an injured Medic, observed exactly **2 effective healing**, and restored the baseline in that process. No arbitrary mechanics or code were accepted.
- Durable Jev credential preflight succeeded; parent directory 0700, credential file 0600. No credential values are in these reports.

## Live Jev mini-smoke

Command actually executed:

```sh
bun run src/balance/v2-runner.ts --run \
  --experiment experiments/jev-quality-v2-live-verified-20261013 \
  --config experiments/jev-balance-v2/smoke-config.json --budget-games 2
```

It exited **0**, phase `complete`, decision `inconclusive`, two attempts, no halt and no evaluation blocks. This was a `frozen_policy` observation smoke, **not candidate acceptance**. Both matches returned model **`jev-1.13.0`**, completed cleanly with zero failed decisions, and used an exact side-swapped configuration:

| Attempt | Rounds | Provider decisions, including placement | Winner | Terminal reason |
|---|---:|---:|---|---|
| 1 | 19 | 148 | player | All opponent units eliminated |
| 2 | 7 | 66 | opponent | All player units eliminated |

The same composition won in both orientations; that is allowed, not forcibly corrected toward every-matchup 50%. Two games are not enough to infer class strength. Both raw request hashes and journal SHA-256 checksums were verified by a separate read-only reanalysis.

Live worker code was `411defe237b877fb03828e0367f7edf2c1655b6e`. A subsequent aggregation-only bug fix used the conventional average-of-middle-two median. The frozen live report is **not rewritten or resumed**: its original upper-middle median remains 19; the separate `reanalysis.json` at analysis commit `e35ef5a` correctly reports mean **13**, median **13**, min **7**, max **19**. Its source manifest hash, source worker commit, analysis source hashes, request identities, journal hashes and explicit non-acceptance eligibility are retained.

A preliminary two-game smoke at `48eaed0` also completed cleanly. Inspecting its real journals exposed round-source/no-direct-impact diagnostic bugs: this engine emits `turn_end`, not `turn_start`; zero healing and cleanup status events must not count as an action's direct impact. RED/GREEN real-engine tests were added, trap attribution was completed from actual placement/trigger events, and a **new** smoke directory was used. The preliminary directory `experiments/jev-quality-v2-live-smoke-20261013` remains local, untouched, with its original frozen metadata; its early-elimination/status/no-effect metrics are superseded and must not be used. **Four live matches total were run during this task**, not a large batch. No live process remains running.

## Actual Codex subscription proposal

```sh
bun run src/balance/v2-review.ts \
  --journal experiments/jev-balance-20261006/raw/attempt-0200/events.jsonl \
  --output experiments/jev-quality-v2-codex-verified-20261013 \
  --source-methodology 1 --design
```

This exited **0** and produced a real read-only Codex/ChatGPT-subscription structured response: `decision: hold`, `validated: true`, `candidateApplied: false`, citing the genuine `source-attempt-200` evidence ID. The saved hypothesis attributes possible pacing problems to policy inactivity, explicitly distinguishes observation from causal/semantic certainty, and refuses a numerical change from one confounded game. Every evidence reference and the full rich proposal schema passed validation. A preliminary Codex review was also preserved locally; **two actual subscription invocations total**, both holds. No fabricated proposal or trace was substituted.

The committed final evidence/proposal retain **source methodology 1**, historical source code commit and journal checksum separately from analysis methodology/source hashes. They are review-only, never v2 holdout evidence or an accepted balance result.

## Preserved and deliberately not done

- Historical `jev-balance-20261006` remains halted, cycle 3, one clean cycle-3 discovery game; **201 attempts is not a completed 500-game target**. Its four manifests (including the archived policy epoch), checkpoint and all available attempt result files were sealed and checked: **206 SHA-256 seals, zero changed**. No old experiment path was written or resumed.
- Preliminary smoke/review artifacts remain local and unmodified; only final sanitized reports and explicit provenance/reanalysis are published. Private raw journals, requests, hidden fixtures, designer prompt/PTY logs and checkpoints stay ignored.
- No balance change was accepted or promoted. No full live candidate holdout evaluation or population/significance claim was made. New mechanics, ability logic and characters are **manual review only**, not supported by the executable numeric candidate schema.
- The game-quality utility is a declared exploratory proxy with seeded paired-block uncertainty, role identity and counters preserved. Composition coverage and policy confounding remain limitations. Semantic prompt compliance, counterfactual ability value and provider determinism are not established.

## Commands for a new balance experiment

Read `experiments/jev-balance-v2/README.md`, then run the verifier and deliberately budget a **new directory**:

```sh
sh scripts/verify-jev-balance.sh
bun run src/balance/v2-runner.ts --run \
  --experiment experiments/next-quality-v2-candidate \
  --config experiments/jev-balance-v2/config.json --budget-games 2
```

Repeating that exact command resumes only if its sealed config/sources are unchanged. It does **not** resume the historical or published smoke experiment. Larger budgets, additional candidate experiments and promotion remain deliberate decisions.
