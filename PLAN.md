# PLAN.md — SIBYL Development Plan

**Current version:** v0.5.13 (80+ training games recorded)

## Status

### ✅ Done
- Core game engine (6×6 grid, 6 classes, turn-based combat)
- Per-unit turn order with speed stat (v0.4.0)
- Prompt compression ~40% token reduction + single LLM call per unit (v0.5.0)
- Vector denial zones, breach mechanic, agent prompt improvements (v0.5.2–v0.5.5)
- Comprehensive test coverage + coverage enforcement (v0.5.7)
- Subagent prompts moved to skills/ (v0.5.9)
- SFT training pipeline — convert, train (MLX LoRA), stats (v0.5.10)
- Training data: 80+ games, model tracking in training JSON
- `--auto` and `--api` flags for automated runs
- Hourly automated balance test cron (posts to #sibyl)

### 🔧 In Progress — v0.6.0: Eval System
From EVAL.md — three-layer evaluation:

1. **Layer 1: Automated Metrics** — `src/eval/metrics.ts`, `bun run eval`
   - Game-level: length, winner, surviving units, total damage
   - Class-level: win rate, damage/game, survival rate, ability usage
   - Decision-level: action success rate, actions/turn, breach impact
   - Output: `eval/metrics/{gameId}.json` + `eval/aggregate.json`

2. **Layer 2: LLM-as-Judge** — `src/eval/judge.ts`, `bun run eval:judge`
   - Per-decision scoring (1–5): tactical quality, prompt adherence, reasoning quality
   - Flags: confused turns, wasted turns, friendly fire, suicidal positioning

3. **Layer 3: Human-in-Loop** — post-game summary to #sibyl, react-based feedback

4. **SFT Quality Filtering** — use eval scores to filter training data

### 📋 Backlog
- **Balance tuning** — use eval metrics to adjust HP/damage numbers
- **SPEC.md cleanup** — spec is outdated (still says "Phase: Design"), update to match implementation
- **More squad configs** — expand test coverage across all class combinations
- **PvP mode** — prompt vs prompt between two humans
- **Web UI** — visual board rendering (currently CLI-only)
- **Fine-tuned model** — train on high-quality filtered SFT data, compare vs base

## Automated Testing

- **Hourly cron**: runs `--auto` (Claude CLI, not API), posts results to #sibyl
- **Training versions**: `training/versions/` — 93 config files across versions
- **Training data**: `training/*.json` — full game logs for SFT

## Next Steps

1. Build Layer 1 eval metrics (`src/eval/metrics.ts`)
2. Run eval across all 80+ existing games to establish baselines
3. Identify class balance issues from aggregate data
4. Implement Layer 2 judge for decision quality scoring
