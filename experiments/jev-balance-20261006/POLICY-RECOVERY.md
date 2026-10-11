# Authorized 10×50 loop: policy adapter recovery

## Outcome

The adapter bug is fixed and verified offline. No numeric balance or engine mechanics changed. The durable runner remains halted: the original 12-hour wall-clock deadline expired at **2026-10-07 07:28:27.822 UTC** (started 2026-10-06 19:28:27.822 UTC). Recovery inspection was 2026-10-11 01:12 UTC, about 101.7 hours after start. No additional provider calls were made; no caps, clock, retries, or attempt counters were reset.

## Evidence / actual failure boundary

`raw/attempt-0116/events.jsonl` is 705,861,319 bytes and contains 182 provider starts, 182 successful provider responses, 175 resolved actions, and a `match_failure` with `decision_error`, `failedDecisions: 1`. There is no `final_state` event. Its terminal Oracle self-Recalibrate addenda grew from 51,380,223 to 102,760,447 to 205,520,895 characters. The last request's lossless text dictionary represents a maximum expansion of **411,041,791 characters**. The adapter explicitly offered the whole CURRENT prompt as a new addendum; the engine appends it to itself, yielding the recurrence `P_next = 2*P + separator`.

The saved `worker_error` result with zero decisions came from the worker's outer catch, which explicitly sets exit code 1. This is not evidence of zero provider calls or a killed worker. The inner decision-error catch executed, then the outer worker boundary failed before final-state recording completed. The original exception class/message and subprocess exit metadata were discarded, so an exact historical exception (e.g. RangeError versus another allocation/serialization error) **cannot be proven** from this attempt. Exponential text growth and the two catch boundaries are proven; allocation/string-serialization failure is the supported inference, not a fabricated logged exception.

## Changes

- Snapshot each live unit's initial tactical vocabulary before actions can mutate another unit's orders. Offer finite original sentence/newline fragments and exact quoted addenda plus three meaningful stock instructions. Never offer the accumulated CURRENT prompt as a self-copy action.
- Vocabulary is capped at 32 distinct texts and 1,024 characters per text, with explicit rejection, not silent truncation. CURRENT orders still reach Jev losslessly through the existing text dictionary.
- Failed worker results cannot erase journal-derived decision/round/failure counts. Journal recovery streams fixed event-header projections with bounded memory rather than reading/splitting the entire giant journal. Raw game text is unchanged.
- Future workers retain allowlisted error categories only (never SDK exception prose/headers), observed counts, and process exit metadata.

## Preserved state and provenance

Original attempt-0116 request, journal, result, and empty log are untouched. `raw/checkpoint-before-policy-recovery.json` backs up the checkpoint verbatim. The active checkpoint only corrects attempt 116 to 182 decisions, round 19, one failed decision, and `decision_error`; the original halt, start clock, attempt IDs and all other results remain intact. `policy-recovery.json` pins original/current complete source hashes and old/new result provenance.

Cycle 1 retains 50 discovery and 32 evaluation games; the proposed Medic maxHp 5→6 remains rejected as `inconclusive_hold`. Cycle 2 retains its 32 CLEAN old-policy discovery games. Frozen manifests and the earlier operational migration are not overwritten. Source compatibility intentionally still rejects this changed policy; this is **not** an operational-only timeout migration.

## Verification

The original full-prompt-copy regression was observed RED before the adapter fix and GREEN afterward. New coverage exercises 500 self-Recalibrations with stable action vocabulary and linear text growth; quoted Breach text remains verbatim; oversized vocabulary fails explicitly; giant journal recovery preserves counts; worker error categories cannot expose messages. `scripts/verify-jev-balance.sh` passes formatter, lint, typecheck, and **247 source tests / zero failures**, with recorder side effects confined to a disposable copy. Scoped suite: 26 tests pass. Existing Codex ChatGPT login is valid; credential file exists with mode 0600 and was not displayed or sourced.

## Continuation handoff (blocked, not silently restarted)

A parent/user must authorize a finite new operational deadline without resetting original elapsed time or increasing the 800-attempt / 1,000-decision-per-game / max-two transient-retry / three-consecutive-failure limits. Also choose an explicit policy-epoch migration and treatment of the 32 old-policy cycle-2 games: do not silently pool them into homogeneous numeric-balance evidence. Replaying 32 slots would add billable games beyond the original 500-discovery scope and needs authorization. Keeping them requires explicit mixed-policy provenance and a conservative hold/isolation decision. No runner process is active and no runner lock exists; there is no background process to hand off until those prerequisites are resolved.
