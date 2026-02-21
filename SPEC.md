# SIBYL — Spec

## Concept
Turn-based grid tactics game where units are controlled by AI agents powered by player-written prompts. Instead of direct control, players craft instructions that define how their units think and act. The better your prompts, the smarter your squad.

## Core Loop

### Setup Phase (once, at game start)
1. Each player selects 3 units for their squad (no duplicate classes)
2. Both sides simultaneously place units in their home rows (rows 0-1 for player, rows 4-5 for opponent)
3. A placement prompt decides where each unit goes
4. Placement is revealed once both sides have committed

### Turn Phase (repeating, up to 20 rounds)
Units act in **speed order** (highest speed first, ties broken randomly). Each unit gets up to 2 actions:
1. **Move** — Move up to movement range (Manhattan distance)
2. **Ability** — Use one class ability
- Move and ability can happen in either order
- A unit can also wait (skip one or both actions)

### Win Condition
Eliminate all 3 enemy units.

## Grid
- **6x6** tiles, coordinates (0,0) bottom-left to (5,5) top-right
- Distance measured by **Manhattan distance** (|dx| + |dy|)
- Player starts bottom (rows 0-1), opponent starts top (rows 4-5)
- Units cannot end on occupied tiles (Specter can move *through* enemies via Ghost Step)
- **Facing** (N/S/E/W) updates automatically based on movement direction

## Key Principles
- **Real AI** — Units are LLM-powered. Prompts are actually interpreted.
- **Free-form prompts** — No templates. Write whatever you want.
- **Fog of war on prompts** — Enemy prompts are hidden by default. Behavior is visible; intent is not.
- **Player vs AI opponent** — Campaign/skirmish against AI with hand-crafted enemy prompts.
- **CLI-first** — Core gameplay loop before any visual platform.

## AI Agent Design
- Each unit receives: system prompt (class/abilities/stats/rules) + player prompt (orders) + game state context + pre-computed recon data
- **Game state context varies by unit** — different classes see different information (see unit passives)
- Agent returns a structured JSON action with `thinking`, `firstAction`, and `secondAction`
- Invalid actions are rejected and the unit wastes its turn
- Two backends: CLI agent (Claude Pro subscription) and API agent (Anthropic API credits)

## Units

All units have a basic `attack` ability (1 damage, range 1) in addition to their class abilities.

### SENTINEL — Front-line Tank
- **HP:** 12 | **Movement:** 2 | **Range:** 1 | **Speed:** 1
- **Active: Shield Wall** — Blocks damage to adjacent allied units from one chosen direction (N/S/E/W) for the rest of the turn.
- **Active: Intercept** — Moves to an adjacent tile next to an ally within 2 tiles and applies Shield Wall. Consumes both move and ability slots.
- **Passive: Fortify** — Takes 50% less damage (rounded up) if it didn't move this turn. Auto-applied each turn, removed on movement.

### SPECTER — Infiltrator / Hacker
- **HP:** 5 | **Movement:** 3 | **Range:** 1 | **Speed:** 3
- **Active: Shadow Strike** — 1 damage, melee range. Does **not** break cloak.
- **Active: Breach** — Range 2, must be behind target (facing away). Replaces target's prompt with provided addendum for 3 turns. Max 2 uses per game, 2-turn cooldown between uses.
- **Active: Cloak** — Invisible for 3 turns. Can't be targeted. Broken by `attack` or `breach` but **not** by `shadow_strike`.
- **Passive: Ghost Step** — Can move through enemy units (but not end on them).

### ORACLE — Scanner / Support
- **HP:** 6 | **Movement:** 3 | **Range:** 4 | **Speed:** 3
- **Active: Scan** — Reveals one enemy unit's prompt + deals 1 damage. Range 4. Scanned prompts persist in Oracle's context.
- **Active: Recalibrate** — Appends a text addendum to an adjacent ally's prompt. Range 1.
- **Passive: Foresight** — Oracle's prompt receives a log of all enemy actions from the previous turn. Other units only see current board state.
- Also sees exact ally HP values (like Medic).

### STRIKER — Ranged Damage
- **HP:** 5 | **Movement:** 2 | **Range:** 2 | **Speed:** 2
- **Active: Precision Shot** — 3 damage at range 2. Reduced to 1 damage if the unit moved this turn.
- **Active: Suppressing Fire** — 1 damage in a 2-tile line from target position. Hit units get `suppressed` status (movement reduced to 1 next turn). Range 2.

### MEDIC — Healer / Buffer
- **HP:** 9 | **Movement:** 2 | **Range:** 1 | **Speed:** 2
- **Active: Patch** — Heals an adjacent wounded ally for 3 HP (capped at max HP). Max 4 uses per game.
- **Active: Overclock** — Target adjacent ally gets 2 ability uses next turn, but takes 1 damage now.
- **Passive: Triage Protocol** — Medic's prompt receives exact ally HP values. Other units only see healthy/wounded/critical.

### VECTOR — Area Control
- **HP:** 7 | **Movement:** 2 | **Range:** 2 | **Speed:** 1
- **Active: Trap** — Places an invisible mine on an empty tile within range 2. Triggers on enemy movement, deals 1 damage.
- **Active: Pulse** — 1 damage to ALL units (friend and foe) within 1 tile of Vector.
- **Passive: Denial** — Enemy units adjacent to Vector cannot use these abilities: `cloak`, `breach`, `scan`, `precision_shot`, `trap`, `patch`, `overclock`. Basic attacks and movement still work.

## Status Effects

| Effect | Source | Duration | Mechanics |
|--------|--------|----------|-----------|
| Cloaked | Specter cloak | 3 turns | Invisible, can't be targeted. Broken by attack/breach (not shadow_strike) |
| Suppressed | Striker suppressing_fire | 1 turn | Movement reduced to 1 tile |
| Shield Wall | Sentinel shield_wall/intercept | Rest of turn | Blocks damage from specified direction for adjacent allies |
| Overclocked | Medic overclock | 1 turn | Grants 2 ability uses next turn |
| Fortified | Sentinel passive | Persistent | 50% damage reduction (ceil). Removed on movement, re-applied each turn |

## Damage & Healing

| Ability | Damage | Notes |
|---------|--------|-------|
| attack | 1 | All units, range 1 |
| shadow_strike | 1 | Specter, range 1, doesn't break cloak |
| scan | 1 | Oracle, range 4, also reveals prompt |
| precision_shot | 3 (1 if moved) | Striker, range 2 |
| suppressing_fire | 1 | Striker, range 2, 2-tile line, suppresses |
| overclock | 1 (to ally) | Medic, side-effect cost |
| trap | 1 | Vector, triggered on enemy step |
| pulse | 1 | Vector, AoE (friend and foe) within 1 tile |
| patch | Heal 3 | Medic, range 1, max 4 uses/game, capped at max HP |

Fortify reduces incoming damage: `ceil(damage / 2)`.

## Squad Composition
Players pick 3 of the 6 unit types. No duplicates. Examples:
- **Sentinel + Striker + Medic** — Classic safe comp. Hold the line, shoot, heal.
- **Specter + Oracle + Vector** — Intel warfare. Reveal, corrupt, and control the board.
- **Sentinel + Vector + Medic** — Fortress. Deny space and outlast.

## Information Model
Not all units see the same game state. This is central to prompt design:

| Unit | Extra Info |
|------|-----------|
| Oracle | Previous turn enemy actions, exact ally HP, scanned enemy prompts |
| Medic | Exact ally HP values |
| All others | Current board positions, own HP, visible enemies, health status (healthy/wounded/critical) |

All units see: own position/HP/facing/status, grid layout, turn order, ally positions, uncloaked enemy positions, own traps.

**Health status thresholds:** healthy (>60% HP), wounded (>25% HP), critical (<=25% HP).

## Facing & "Behind" Mechanic
- Units face N, S, E, or W. Player units initially face N, opponent units face S.
- Facing updates automatically after movement based on direction traveled:
  - If |dy| >= |dx|: face N (if dy > 0) or S (if dy < 0)
  - Otherwise: face E (if dx > 0) or W (if dx < 0)
- **Behind** (for Breach): attacker must be on the opposite side of the target's facing direction.

## Enemy AI
- Opponent units are also LLM-powered with hand-crafted tactical prompts
- Difficulty = quality of enemy prompts
- Random config generation picks from pre-written tactical prompts per class

## Status
**Phase:** Playable (v0.5.13)
