# EVAL.md — Evaluation System Design

## Overview

Three-layer eval system that measures game balance, decision quality, and enables human feedback. Feeds back into SFT training data quality filtering.

## Layer 1: Automated Metrics (from game JSON)

Extract per-game and aggregate metrics from `training/*.json`:

### Game-Level Metrics
- **Game length** — rounds played (healthy: 3–15; <3 = steamroll, >15 = stalemate)
- **Winner** — which side won
- **Surviving units** — count and HP remaining
- **Total damage dealt** — per side

### Class-Level Metrics
- **Win rate by class** — flag if any class consistently over/underperforms across N games
- **Damage per game** — average damage dealt by each class
- **Survival rate** — how often each class survives to end
- **Ability usage distribution** — are all abilities being used? Unused = bad prompts or bad design

### Decision-Level Metrics
- **Action success rate** — how often units attempt invalid actions (occupied tile, out of range, etc.). Measures prompt quality
- **Actions per turn** — are units using both action slots or wasting them?
- **Breach impact score** — damage dealt by breached units to own team vs cost to set up

### Output
- `eval/metrics/{gameId}.json` — per-game metrics
- `eval/aggregate.json` — rolling aggregate across all games
- `bun run eval` — run metrics on all games
- `bun run eval:report` — markdown summary

---

## Layer 2: LLM-as-Judge (automated quality scoring)

Feed game logs to a judge model that scores decision quality:

### Per-Decision Scoring (1–5)
- **Tactical quality** — was this a good move given the board state?
- **Prompt adherence** — is the unit following its class prompt?
- **Reasoning quality** — does the `💭` thinking line show sound logic?
- **Outcome alignment** — did the action achieve what the reasoning predicted?

### Flags
- **Confused turns** — reasoning contradicts the action taken
- **Wasted turns** — both actions are `wait` or fail
- **Friendly fire** — attacking own team (unless breached)
- **Suicidal positioning** — moving adjacent to lethal threats at low HP

### Output
- `eval/judge/{gameId}.json` — per-decision scores
- Judge model: use a different/stronger model than the game agent to avoid self-evaluation bias

---

## Layer 3: Human-in-Loop

### Post-Game Summary Card
After each game, post to #sibyl with:
- Win/loss, turns, surviving units
- Automated metrics highlights (any flags?)
- Judge scores summary (worst-rated decisions)
- React with 👍/👎 for overall game quality

### Decision Review
- On 👎, trigger deeper analysis of flagged decisions
- Human can annotate specific turns with notes
- Stored as `eval/feedback/{gameId}.jsonl`:
  ```jsonl
  {"turnId": "t3-p-Hawk", "rating": 1, "note": "should have retreated instead of engaging 1v3"}
  {"gameId": "v0.5.13-88", "rating": 4, "note": "good game, breach timing was smart"}
  ```

---

## SFT Quality Filtering

Use eval data to improve training:

1. **Filter by game quality** — only train on games rated above threshold
2. **Filter by decision quality** — exclude turns with judge score <3
3. **Weight by quality** — higher-scored examples get more weight
4. **Track model provenance** — compare eval scores across models to measure improvement

### Model Tracking
Every training example includes the model that generated it:
- `metadata.model` in SFT JSONL (e.g., `"claude-sonnet-4-20250514"`)
- `model` field in training JSON game records
- Enables A/B comparison: does fine-tuned model score better than base?

---

## Implementation Order

1. **Model tracking** — add to training data + backport existing runs ✅
2. **Layer 1** — `src/eval/metrics.ts`, `bun run eval`
3. **Layer 2** — `src/eval/judge.ts`, `bun run eval:judge`
4. **Layer 3** — post-game summary in balance cycle, feedback storage
5. **SFT integration** — quality filtering in `sft/src/convert.ts`
