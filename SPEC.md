# SIBYL — Spec

## Concept
Turn-based grid tactics game where units are controlled by AI agents powered by player-written prompts. Instead of direct control, players craft instructions that define how their units think and act. The better your prompts, the smarter your squad.

## Core Loop

### Setup Phase (once, at game start)
1. Each player selects 3 units for their squad
2. Both sides simultaneously place units in their home rows (rows 1-2 for player, rows 5-6 for opponent)
3. A placement prompt decides where each unit goes
4. Placement is revealed once both sides have committed

### Turn Phase (repeating)
Player goes first, then opponent. Each unit on the active side acts one at a time:
1. **Order prompt** — Decides which unit acts and in what order
2. **Move prompt** — Decides how that unit moves (up to its movement range)
3. **Ability prompt** — Decides what ability to use and where
- Move and ability can happen in either order per unit

### Win Condition
Eliminate all 3 enemy units.

## Grid
- **6×6** tiles
- Cover, line of sight, adjacency, and facing all matter
- Player starts bottom (rows 1-2), opponent starts top (rows 5-6)

## Key Principles
- **Real AI** — Units are LLM-powered. Prompts are actually interpreted.
- **Free-form prompts** — No templates. Write whatever you want.
- **Fog of war on prompts** — Enemy prompts are hidden by default. Behavior is visible; intent is not.
- **Player vs AI opponent** — Campaign/skirmish against AI with hand-crafted enemy prompts.
- **CLI-first** — Core gameplay loop before any visual platform.

## AI Agent Design
- Each unit receives: system prompt (class/abilities/stats/rules) + player prompt (orders) + game state context
- **Game state context varies by unit** — different classes see different information (see unit passives)
- Agent returns a structured action (validated against game rules)
- Invalid actions are rejected and the unit wastes its turn

## Units

### SENTINEL — Front-line Tank
- **HP:** High | **Movement:** 2 | **Range:** Melee (1)
- **Active: Shield Wall** — Blocks all damage to adjacent allied units from one chosen direction (N/S/E/W) until next turn. Prompt must specify direction based on board state.
- **Active: Intercept** — Moves to block an incoming attack targeting an ally within 2 tiles. Consumes both ability and move.
- **Passive: Fortify** — Takes 50% less damage if it didn't move this turn.

### SPECTER — Infiltrator / Hacker
- **HP:** Low | **Movement:** 3 | **Range:** Melee (1)
- **Active: Breach** — Must be adjacent to an enemy from behind (facing away). Reveals that unit's prompt and appends one sentence to it for the next round. Does not replace — corrupts.
- **Active: Cloak** — Invisible for 1 turn. Can't be targeted. Broken by using Breach or attacking.
- **Passive: Ghost Step** — Can move through enemy units (but not end on them).

### ORACLE — Scanner / Support
- **HP:** Medium | **Movement:** 2 | **Range:** 4
- **Active: Scan** — Reveals one enemy unit's current prompt until end of next round. Range 4.
- **Active: Recalibrate** — Lets an ally re-roll their action with a temporary prompt addendum written on the spot.
- **Passive: Foresight** — Oracle's prompt receives info about what enemy units did last turn. Other units only see current board state.

### STRIKER — Ranged Damage
- **HP:** Medium | **Movement:** 2 | **Range:** 3
- **Active: Precision Shot** — High damage, range 3, requires line of sight. Can't fire after moving.
- **Active: Suppressing Fire** — Low damage in a 2-tile line. Hit units have movement reduced to 1 next turn.
- **Passive: High Ground** — If no unit is adjacent, gains +1 range.

### MEDIC — Healer / Buffer
- **HP:** Medium | **Movement:** 2 | **Range:** 1 (touch)
- **Active: Patch** — Heal an adjacent ally.
- **Active: Overclock** — Target ally gets two abilities next turn instead of one, but takes 1 damage.
- **Passive: Triage Protocol** — Medic's prompt receives exact ally HP values. Other units only see healthy/wounded/critical.

### VECTOR — Area Control
- **HP:** Medium | **Movement:** 2 | **Range:** 2
- **Active: Trap** — Places an invisible mine on an empty tile within range 2. Triggers on enemy movement.
- **Active: Pulse** — 1 damage to ALL units (friend and foe) within 1 tile. Prompt must weigh friendly fire.
- **Passive: Denial** — Enemy units adjacent to Vector can't use abilities (only move).

## Squad Composition
Players pick 3 of the 6 unit types. No duplicates. Examples:
- **Sentinel + Striker + Medic** — Classic safe comp. Hold the line, shoot, heal.
- **Specter + Oracle + Vector** — Intel warfare. Reveal, corrupt, and control the board.
- **Sentinel + Vector + Medic** — Fortress. Deny space and outlast.

## Information Model
Not all units see the same game state. This is central to prompt design:
| Unit | Extra Info |
|------|-----------|
| Oracle | Previous turn enemy actions |
| Medic | Exact ally HP values |
| All others | Current board positions, own HP, visible enemies, basic status (healthy/wounded/critical) |

## Enemy AI
- Opponent units are also LLM-powered with hand-crafted prompts
- Difficulty = quality of enemy prompts
- Future: PvP mode (prompt vs prompt)

## Open Questions
- Exact HP/damage numbers (need playtesting)
- Facing mechanic details (how is "behind" determined?)
- What happens when Breach corrupts a prompt — does the victim know?
- Prompt injection as intentional mechanic vs exploit (leaning: feature)
- Token/cost management per game
- Unit unlock/progression system?
- Tech stack and LLM choice (needs to be fast + cheap)

## Status
**Phase:** Design
