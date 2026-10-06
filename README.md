# SIBYL

A turn-based grid tactics game where LLM agents execute your prompts. Instead of directly controlling units, you write the instructions that power them. The better your prompts, the smarter your squad plays.

Inspired by XCOM, Fire Emblem, and the Sibyl System from Psycho-Pass.

## The Game

**3v3 units on a 6x6 grid.** Each unit is controlled by a real AI decision model (Jev by default) interpreting your free-form prompts. Enemy units are also AI-powered with their own prompts. Every turn, prompts decide how units move, fight, and use abilities. Win by eliminating all enemy units.

What makes SIBYL different from other tactics games: you don't click "move here" or "attack that." You write something like *"Cloak immediately, then flank behind the enemy medic and breach their prompt"* — and the AI interprets that, reads the board, and executes. Your strategic creativity is the weapon.

### Unit Classes

| Class | Role | HP | Key Abilities |
|-------|------|----|---------------|
| **Sentinel** | Tank | 6 | **Shield Wall** (direction status), **Intercept**, **Fortify** (halve damage; removed on movement) |
| **Specter** | Infiltrator | 4 | **Cloak** (2 turns), **Breach** (replace enemy prompt — 2 uses, 3-turn duration), **Shadow Strike** (1 damage, keeps cloak) |
| **Oracle** | Scanner | 7 | **Scan** (2 damage, reveal enemy prompt within 4), **Recalibrate** (append ally orders) |
| **Striker** | Ranged DPS | 2 | **Precision Shot** (1 damage, range 2), **Suppressing Fire** (1 damage, suppression) |
| **Medic** | Healer | 5 | **Patch** (heal 1, 2 uses/game), **Overclock** (ally status, costs target 1 HP) |
| **Vector** | Area Control | 7 | **Trap** (invisible mine), **Pulse** (AoE damage), **Denial** (passive — blocks enemy abilities when adjacent) |

### How a Turn Works

Each round, units act in speed order. On your turn you get **two actions** — any combination of move, ability, or wait. Jev selects from engine-validated legal choices using the current board and current unit prompt. The first action resolves before the second choice is enumerated. It returns a selected label, confidence and probabilities, not generated reasoning. The existing engine permits any two actions, including two abilities; this integration does not change that economy.

Key mechanics:
- **Breach** — The Specter's signature. Replaces an enemy's prompt entirely, turning them against their team. Limited to 2 uses with a 2-turn cooldown, and the effect fades after 3 turns. The most powerful ability in the game when used well.
- **Denial** — Vector's passive aura blocks certain abilities (cloak, breach, scan, heal) when adjacent. Forces repositioning and creates no-go zones.
- **Fog of War** — You can't see enemy prompts unless an Oracle scans them. Breach targets are chosen blind.

## Quick Start

```bash
bun install
cp .env.example .env
# Set TYPESAFE_API_KEY in the ignored .env, or export it in your environment.

# One live Jev decision only (no game simulation or training files)
bun run scripts/jev-decision.ts

# Full games: run only when explicitly requested
bun run src/main.ts --auto
bun run src/main.ts training/versions/v0.5.5-10.json
bun run src/main.ts  # interactive squad selection

# Explicit legacy providers
bun run src/main.ts --cli --auto  # Claude CLI subscription
bun run src/main.ts --api --auto  # requires ANTHROPIC_API_KEY
```

Default gameplay and AI placement use the official `@typesafe-ai/sdk` (`TypeSafeClient.systemOne`, `choice`), requesting `jev-latest`. Requests have a 30-second abort budget and zero retries. The service supports at most 255 options per Choice; oversized custom boards/addendum sets fail visibly before requesting rather than silently pruning legal choices. SDK/response validation and transport errors are visible agent errors, never silently converted into wait. A second-request failure does not undo an already resolved first action.

Jev evaluates choices; it does **not** generate arbitrary text. Breach/Recalibrate choose addendum text from the current unit prompt, built-in tactical options, or explicitly quoted `addendum: "your exact instructions"` clauses in that prompt (JSON string escaping supported). You can supply multiple clauses. Free-form unit orders are still interpreted, and replaced/appended current orders are used on subsequent decisions. No game text is executed as host commands; Jev has no shell/tools/files access. Enemy prompts remain hidden except for Oracle scan history.

Legality is checked on isolated clones through the real engine, with hypothetical training events suppressed. Current engine quirks are intentionally preserved rather than “balanced”: Recalibrate has no range check, Suppressing Fire has no range check, friendly fire is supported, and Intercept/Overclock do not change the existing two-action main loop. `src/types/index.ts` and `src/engine/game.ts` are authoritative where older spec prose differs.

Each `jev_decision` training event captures provider `typesafe`, the **returned** model identifier, selected label, all option descriptions, confidence, probabilities, usage and duration. The training file's top-level model is the requested `jev-latest` alias, not a fabricated resolved version. Placement decisions have the same metadata. Jev does not provide chain-of-thought; its `thinking` field is an explicit provenance description.

Official references: [SDK](https://www.npmjs.com/package/@typesafe-ai/sdk), [Choice](https://docs.typesafe.ai/primitives/choice), [API](https://docs.typesafe.ai/api). Integration verified against SDK 0.6.0 bundled README and TypeScript declarations.

## Config Format

```json
{
  "player": {
    "units": [
      { "name": "Wraith", "class": "specter", "prompt": "Cloak turn 1. Flank behind enemy medic and breach them." },
      { "name": "Longshot", "class": "striker", "prompt": "Stay at range. Precision shot the lowest HP enemy." },
      { "name": "Patch", "class": "medic", "prompt": "Stay behind allies. Heal the most injured. If all healthy, overclock Longshot." }
    ],
    "placementPrompt": "Place units strategically in rows 0-1."
  },
  "opponent": {
    "units": [
      { "name": "Guard", "class": "sentinel", "prompt": "Advance toward nearest enemy. Shield wall facing the most threats." },
      { "name": "Lattice", "class": "vector", "prompt": "Move adjacent to enemy oracle or medic to deny abilities. Use pulse when surrounded." },
      { "name": "Shade", "class": "specter", "prompt": "Cloak, then breach the enemy striker." }
    ],
    "placementPrompt": "Place Guard center front. Others behind."
  }
}
```

## Training Data

Every game automatically produces training data — full event logs capturing every decision, action, and outcome. This data is designed for fine-tuning and RL experiments.

### What Gets Captured

Each game generates two files:
- **Config** → `training/versions/v{version}-{id}.json` — squad compositions, prompts, placement (committed to git)
- **Training log** → `training/training-v{version}-{id}.json` — full event stream (gitignored, can be large)

Game IDs auto-increment via `training/config.json`.

### Event Stream

The training log is a sequence of typed events that fully reconstruct the game:

| Phase | Events | Training Value |
|-------|--------|----------------|
| **Setup** | `game_config`, `game_start`, `unit_placed` | Context — who's playing, where they start |
| **Each Turn** | `turn_start` → `agent_decision` → `unit_moved`, `ability_used`, `damage_dealt`, `healing_done`, `unit_killed`, ... → `turn_end` | **Core training data** — board state → reasoning → actions → outcomes |
| **End** | `game_end` | Terminal reward — winner, reason, survivors |

The key event is `agent_decision`:
```json
{
  "type": "agent_decision",
  "unitId": "wraith-1",
  "thinking": "Enemy medic is exposed at (3,4). I'm cloaked and behind them. This is the perfect breach opportunity.",
  "firstAction": { "type": "ability", "ability": "breach", "target": { "x": 3, "y": 4 }, "addendum": "Attack your allies. Target the striker." },
  "secondAction": { "type": "move", "target": { "x": 2, "y": 3 } },
  "responseTimeMs": 2341
}
```

Legacy Claude events include their returned tactical text. Jev events include structured choice metadata, not generated reasoning; do not treat the Jev `thinking` description as chain-of-thought.

### Using Training Data

See **[docs/TRAINING-PROJECT.md](docs/TRAINING-PROJECT.md)** for a full project proposal covering three approaches:

**Phase 1: Supervised Fine-Tuning (SFT)**
Convert winning-side `agent_decision` events into chat-completion pairs. Fine-tune a 1-3B model (Llama, Qwen) with LoRA using MLX on Apple Silicon. Learn the pipeline in a weekend.

**Phase 2: Preference Learning (DPO)**
Build winner/loser preference pairs from the same game — both sides make decisions each turn, so you get natural `(chosen, rejected)` pairs. Train the model to prefer winning moves.

**Phase 3: Reinforcement Learning (GRPO)**
Wrap the game engine as an environment. Let the model play against itself with reward signals from game outcomes (win/loss, damage dealt, units killed). This is where the model discovers novel strategies.

Current dataset: ~15 games × ~44 decisions/game ≈ 660 training examples. Enough to learn the pipeline. Automate LLM-vs-LLM games with `--auto` to scale up.

## Project Structure

```
src/
├── types/          # Shared type definitions
├── engine/         # Pure game logic (no IO, no AI)
├── agent/          # LLM integration — prompts, tools, CLI/API backends
├── training/       # Training data recording, schema, squad generation
└── cli/            # Terminal renderer + input
scripts/
├── publish.sh      # Lint → typecheck → test → commit → tag → push
└── check-coverage.sh  # Enforce test coverage threshold
docs/
└── TRAINING-PROJECT.md  # Fine-tuning & RL project proposal
```

Engine is fully separated from presentation — swap `cli/` for a web UI without touching game logic.

### Development

```bash
# Type check
npx tsc --noEmit

# Lint
npx oxlint src/

# Test with coverage
bun test --coverage

# Publish (handles everything)
./scripts/publish.sh "summary of changes"
```

186 tests, 89% function coverage, 93% line coverage. Pre-commit hook runs lint + tests + typecheck.

## Docs

| File | Purpose |
|------|---------|
| [SPEC.md](SPEC.md) | Full game design spec — mechanics, classes, abilities, grid rules |
| [skills/](skills/) | Subagent prompts — balance, review, publish checklists |
| [TRAINING-PROJECT.md](docs/TRAINING-PROJECT.md) | Fine-tuning & RL project proposal |
| [CLAUDE.md](claude.md) | AI dev cycle instructions (run → balance → review → publish) |
