# SIBYL

A turn-based grid tactics game where AI agents execute your prompts. Instead of directly controlling units, you write the instructions that power them. The better your prompts, the smarter your squad plays.

Inspired by XCOM, Fire Emblem, and the Sibyl System from Psycho-Pass.

## How It Works

- **3v3** units on a **6x6** grid
- Each unit is controlled by a real LLM (Claude) interpreting your free-form prompts
- Enemy units are also AI-powered with their own prompts
- Every turn: your prompts decide how units move, fight, and use abilities
- Win by eliminating all enemy units

## Unit Classes

| Unit | Role | Key Ability |
|------|------|-------------|
| **Sentinel** | Tank | Shield Wall — blocks damage from a direction |
| **Specter** | Infiltrator | Breach — hack an enemy's prompt from behind |
| **Oracle** | Scanner | Scan — reveal an enemy's prompt |
| **Striker** | Ranged DPS | Precision Shot — high damage at range |
| **Medic** | Healer | Patch — heal adjacent allies |
| **Vector** | Area Control | Trap — place invisible mines |

## Quick Start

```bash
# Install dependencies
bun install

# Run with a config file
bun run src/main.ts test-config.json

# Run interactively (pick units + write prompts in terminal)
bun run src/main.ts
```

Requires an `ANTHROPIC_API_KEY` in `.env`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Config Format

```json
{
  "player": {
    "units": [
      { "name": "Wraith", "class": "specter", "prompt": "Cloak and breach the enemy medic..." }
    ],
    "placementPrompt": "Place units strategically in rows 0-1."
  },
  "opponent": {
    "units": [
      { "name": "Guard", "class": "sentinel", "prompt": "Advance and shield wall..." }
    ],
    "placementPrompt": "Place units in rows 4-5."
  }
}
```

See `test-config.json` for a full example.

## Project Structure

```
src/
├── types/       # Type definitions
├── engine/      # Pure game logic (no IO, no AI)
├── agent/       # LLM integration + prompt construction
└── cli/         # Terminal renderer + input
```

Engine is fully separated from presentation — swap `cli/` for a web UI without touching game logic.

## Status

Early prototype. CLI only. See [SPEC.md](./SPEC.md) for the full design doc.
