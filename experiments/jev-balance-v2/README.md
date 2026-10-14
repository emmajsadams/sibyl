# Sibyl game-quality methodology v2

This is a **new experiment protocol**, not a continuation of `jev-balance-20261006`.
One experiment freezes one policy, one baseline and one candidate. Run another directory for the next candidate or a policy/engine change. Nothing here rewrites v1 manifests, results or checkpoints, edits `BALANCE` automatically, or launches the old 500-game target.

## Historical boundary

At inspection v1 was halted at cycle 3 with **one clean discovery game** in that cycle: 201 total attempts, 197 clean including archived history, 165 clean in the active epoch (100 discovery + 64 evaluation + cycle 3's one), four failed attempts, 33 archived attempts. It is **not a completed 500-game experiment**. The former baseline suite had 254 tests. Preserve those raw artifacts and manifests; do not restart them with the v2 sources. V2 adds scan damage/kill, recalibrate target, and breach-expiry events that were missing from the engine journal; game rules and prompts are unchanged.

## Run deliberately

From the repository, with the existing authenticated ChatGPT Codex subscription and Jev credential:

```sh
sh scripts/verify-jev-balance.sh
bun run src/balance/v2-runner.ts --run \
  --experiment experiments/my-quality-v2-candidate-01 \
  --config experiments/jev-balance-v2/config.json --budget-games 2
```

`--budget-games` is the **attempt budget for this invocation**, not a clean-game target. Repeating the exact command with the same config/sources resumes saved slots without replaying completed games. The original absolute wall clock, total attempt cap and retry counters survive resume. A budget pause is not completion. Increase the invocation budget only intentionally; the supplied config allows 50 discovery games and **up to 96 evaluation games**, not an automatically launched batch. One match is a separate bounded process, with the original 1,000-decision limit; only HTTP 502 and whole-match timeouts receive at most two retries, and three consecutive failed attempts halt. Interruptions and source/config changes stop for inspection, not silent recovery. A pending crash requires a new experiment unless a separately reviewed recovery is implemented.

`kind: "frozen_policy"` observes the frozen adapter and balance only: discovery evidence is saved, no designer or numerical evaluation is run. `kind: "balance"` keeps that policy fixed, obtains a structured proposal, then compares only a whitelisted numeric candidate. An adapter/prompt change is a **policy experiment**, never an operational tweak to a frozen balance comparison. The returned provider model is recorded in private journals; `jev-latest` is remotely mutable, so local source pinning does not imply provider determinism.

Credentials prefer `TYPESAFE_API_KEY`, otherwise the existing durable file `/Users/emma/.hermes/credentials/sibyl-jev.env0600` (0600, parent 0700); literal parser only, never shell-source it. Preflight happens before checkpoint creation and before every reservation. Workers receive only an explicitly allowlisted process environment plus the Jev key. Designer processes receive no API keys and use the existing Codex subscription login. Designer failure/auth/schema errors halt with private artifacts; there is no API-key fallback or automatic quota retry.

## Evidence, not just wins

The same recorder path used by real matches consumes actual engine events and resolved actions. Reports retain numeric observations, class labels and **real journal line references**, not prompts, responses or fabricated excerpts:

- Duration distribution; stalemate rate (including HP-tiebreak wins); eliminations by round 3; steamroll proxy (elimination by round 5 with at least half the starting units surviving).
- Per-class units, enemy damage, friendly/self damage, effective healing, kills, deaths, survivors, survival rounds, observable control contributions and status-exposure snapshots.
- Per-ability uses/errors, damage/healing/kills, applied statuses, breach targets and recalibrate rewrites; Denial is observed separately. These are observed impacts, **not counterfactual causal ability values**. Trap damage is attributed through real placement/trigger events; without a recorded placement the per-ability amount remains observable but the source class is unknown. Status-exposure counts use the engine's actual round-end snapshots and undercount effects that expire within a round. Historical missing events must not be interpreted as absent effects.
- Wait rate, rejected actions, provider/decision failures, abilities without a directly observed effect, and action/wait counts while prompt rewrites are active. These are **policy/prompt-following proxies, not semantic instruction-compliance measurements, proof of mistakes, or LLM certainty**. Shielding, waiting, traps and information can be strategically useful. Provider confidence is not used as game-quality evidence.
- Team-composition appearances/wins/draws and class contribution coverage. Sparse compositions and policy confounding are explicit. Intentional counters and distinct roles are allowed; no objective forces every matchup or class to 50% wins.

`evidence.json` contains both per-match observations and descriptive summaries. Incomplete/torn journals, skipped oversized lines and dirty decisions cannot silently become clean v2 evaluation evidence. Journal replay streams with a bounded line buffer, reports skipped lines and stores a SHA-256 journal checksum. Raw journals are retained unchanged.

## Declare the objective before seeing a candidate

The config, objective, full source-file hashes, balance and exact discovery/holdout fixtures are frozen before the designer is called. Holdouts are unique (including side swaps), fresh relative to discovery and hidden from the supplied designer prompt. Generation is stochastic; exact generated fixtures, not a promise of RNG regeneration, are the replay source.

The default declared utility is a weighted sum of:

1. **Pacing, 0.30:** full credit in rounds 6–14, linear out-of-band penalty; stalemates and steamrolls receive zero pacing credit.
2. **Role contribution, 0.30:** mean over present classes of capped per-unit `(enemy damage + effective healing + enemy kills + observed control) / roleTarget`. Targets are separately declared per class; control includes breach, recalibrate, cloak/shield applications and observed Denial blocks. This is deliberately a simple tunable proxy, not a universal definition of fun.
3. **Contribution diversity, 0.20:** fraction of present classes with nonzero observed contribution. Actual composition coverage/outcomes are reported separately; this is **not a measurement of population metagame diversity**.
4. **Side imbalance, 0.20:** tolerate side-score 0.25–0.75 across each swapped pair; penalize more extreme orientation advantage. A composition that wins in both orientations is allowed. This addresses side bias, **not causal class-strength inference**.

A paired block is four games: baseline and candidate on the **same fresh configuration**, each in both side orientations. Differences in block utility are resampled as whole blocks, using a fixed seeded PRNG and 2,000 percentile-bootstrap draws. Individual games are not treated as independent samples. The report includes mean improvement, descriptive 95% bootstrap interval, component deltas, seed, block/game counts and regression gates.

Default declared looks are 8, 16 and 24 blocks (32, 64, 96 evaluation games). Accept a recommendation only when the lower interval endpoint exceeds the configurable practical-effect threshold (0.03) and regression gates pass. Reject when upper endpoint is below -0.03 or a component regresses beyond tolerance. Otherwise accumulate to the next declared look, then return **inconclusive** at the cap. No unanimous 7/8 rule. Stalemates/steamrolls may not rise by more than 0.05, pacing/roles/diversity/side balance may not fall by more than 0.05, and errors may not rise. Test/typecheck/lint/format verification is required before persisting an accepted recommendation.

These are **exploratory sequential decisions**, not calibrated sequential hypothesis tests or population-significance claims. Bootstrap intervals can be degenerate with small/discrete samples. Repeated looks, multiple candidates, policies and noisy role proxies are not corrected for multiplicity. Never tune thresholds/weights after inspecting a candidate, stop at an undeclared favorable look, reuse holdouts for a redesign, or portray these intervals as certainty. A confirmatory independently preregistered evaluation remains a future extension.

## Designer and human review

The strict structured proposal carries decision, falsifiable hypothesis, rationale, evidence IDs, expected effects, numeric changes and manual-review requests. Unknown keys, invented evidence IDs, duplicate paths, arbitrary code, mechanics changes and out-of-bounds values fail validation. `propose` permits **one or two related integer changes** for the same role (or one shared ability), each +/-1 or at most 15%, within the actual `BALANCE` unit-stat/ability whitelist. A hold/review applies no changes. The designer can hold; evidence does not force a change.

New abilities, characters, mechanics, targeting rules, economy changes or prompts belong in `manual_review`, with a design hypothesis and evidence references; they **are not implemented or executable through this numeric schema**. Future expansion should add explicit engine/schema support, role-specific tests, event instrumentation, safety bounds, a new policy/methodology epoch and fresh holdouts. Review `proposal.json`, the cited real lines privately and all declared gate results before promoting an accepted JSON recommendation into source. The runner never auto-pushes results or edits game balance.

Read-only historical evidence review (new output directory, never resumes v1):

```sh
bun run src/balance/v2-review.ts \
  --journal experiments/jev-balance-20261006/raw/attempt-0200/events.jsonl \
  --output experiments/my-v2-historical-review \
  --source-methodology 1 --design
```

The review validates clean result/request identity, extracts actual journal evidence, invokes read-only Codex with the rich schema and validates every reference. Historical review is **not eligible for v2 acceptance**, even if Codex proposes a number.

## Artifacts and verification

- Public: sanitized `manifest.json` (sources, objective, baseline, fixture hashes), `evidence.json`, `proposal.json`, declared `look-N.json`, `evaluation.json`, and only if gates pass `accepted-balance.json`.
- Private/ignored: `raw/manifest.json` (exact fixtures), checkpoint, per-attempt request/result/journal, designer prompt/PTY log/schema/output. Keep them for audit. Do not commit raw prompts, provider payloads, credentials or private logs. Custom experiment directories outside `experiments/*` need equivalent ignore rules before staging.
- Replay reads the immutable journal with the matching request/balance/source commit and checksums. Re-running a live remote provider is a new stochastic game, not byte-identical replay.
- Offline tests use clearly named **decision stubs with the real engine**, including bounded real-engine failures, metrics, proposal-schema fixtures, all three gate decisions, pause/resume and the complete holdout path. These test fixtures are not real Jev game results. The production CLI has no simulator/provider-stub fallback.

Run `sh scripts/verify-jev-balance.sh` for formatter, scoped lint, typecheck and the entire source suite in a disposable copy, avoiding legacy recorder writes in this checkout. Tests exercise actual events; the live mini-smoke and Codex review must be reported separately from offline tests. Do not claim the old 500 games, a full live v2 candidate evaluation, causal ability values, new mechanics or population balance have been verified by a mini-smoke.
