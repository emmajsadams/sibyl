# Training Data

## File Naming

Files are stored in `training/` with the format:

```
training-v{version}-{gameId}.json
```

- **version**: from `package.json` (e.g. `0.5.0`)
- **gameId**: auto-incrementing integer from `training/config.json`

Examples: `training-v0.5.0-0.json`, `training-v0.5.0-1.json`

## Versioned Configs

Each training run saves its game config to `training/versions/`:

```
training/versions/v{version}-{gameId}.json
```

These are committed to git (they're inputs, not outputs). Training output files reference them by `configId`.

## Config

`training/config.json` stores runtime state (typed via Zod in `src/training/config.ts`):

```json
{
  "nextGameId": 0
}
```

Incremented automatically each game. Auto-created on first run if missing. Reset manually when needed (e.g. new version).

## Random Squad Generation

When running without a config file in non-interactive (API) mode, SIBYL generates random squads via `src/training/squads.ts`:

- Picks 3 random classes per side (no duplicates within a side)
- Assigns thematic names and tactical prompts from templates
- Generates a placement prompt for each side
- The generated config is saved to `training/versions/` like any other config

Usage: `bun run src/main.ts` (no config argument, no --cli flag)

## File Structure

Each training file is a JSON object:

```json
{
  "configId": "v0.5.0-0",
  "gameId": "v0.5.0-0",
  "timestamp": "2026-02-16T07:04:17.000Z",
  "agent": "claude-sonnet-4-20250514",
  "events": [ ... ]
}
```

The `configId` references the versioned config file at `training/versions/v0.5.0-0.json`.

## Event Types

Events are recorded in order as the game plays out:

| Event | Description |
|---|---|
| `game_config` | Full input config: player/opponent sides, agent, config file path |
| `game_start` | Grid size, initial units, turn stack |
| `turn_start` | Round N begins — full unit/trap snapshots, turn order |
| `unit_placed` | Unit placed during setup phase |
| `unit_moved` | Movement with facing update, trap triggers |
| `ability_used` | Ability attempt (success/fail + error reason) |
| `damage_dealt` | Damage from abilities, with HP after |
| `healing_done` | Medic patch heal, heals remaining |
| `status_applied` | Buff/debuff applied (cloaked, suppressed, fortified, etc.) |
| `status_removed` | Status expired or broken |
| `unit_killed` | Death — who killed whom, with what |
| `trap_placed` | Vector trap placed at position |
| `trap_triggered` | Unit stepped on trap |
| `breach` | Specter breach — old prompt replaced with attacker's addendum |
| `agent_decision` | LLM output: thinking + two actions + response time (ms) |
| `denial_blocked` | Vector passive blocked an adjacent enemy's ability |
| `turn_end` | Round N ends — full unit/trap snapshots |
| `game_end` | Winner, reason, total turns, survivors |

## Schema

Full Zod schema with all event types: `src/training/schema.ts`

## Recording

`src/training/recorder.ts` handles:
- Reading version + game counter
- Creating the training file and versioned config file
- Incrementing the counter
- `record(event)` appends and flushes to disk immediately
- Static helpers for snapshotting units/traps from game state
