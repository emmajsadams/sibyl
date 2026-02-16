# Training Data

## File Naming

Files are stored in `training/` with the format:

```
training-v{version}-{gameId}.json
```

- **version**: from `package.json` (e.g. `0.5.0`)
- **gameId**: auto-incrementing integer from `training/config.json`

Examples: `training-v0.5.0-0.json`, `training-v0.5.0-1.json`

## Config

`training/config.json` stores runtime state:

```json
{
  "nextGameId": 0
}
```

Incremented automatically each game. Reset manually when needed (e.g. new version).

## File Structure

Each training file is a JSON object:

```json
{
  "version": "0.5.0",
  "gameId": "v0.5.0-0",
  "timestamp": "2026-02-16T07:04:17.000Z",
  "agent": "claude-sonnet-4-20250514",
  "config": "optional config string",
  "events": [ ... ]
}
```

## Event Types

Events are recorded in order as the game plays out:

| Event | Description |
|---|---|
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
- Creating the file and incrementing the counter
- `record(event)` appends and flushes to disk immediately
- Static helpers for snapshotting units/traps from game state
