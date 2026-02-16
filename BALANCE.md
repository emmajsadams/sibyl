# BALANCE.md — Balance Review Process

Run this after a game to analyze training data and identify balance issues.

## Process

1. Read the latest training output file in `training/`
2. Read the corresponding version config in `training/versions/`
3. Analyze the game for balance issues using the checklist below
4. Fix any issues found in the game engine or class stats
5. Re-run analysis after fixes to verify
6. Output a clear summary of findings and changes

## Analysis Checklist

### Game Flow
- [ ] Did the game last a reasonable number of rounds? (3-15 is healthy, <3 = steamroll, >15 = stalemate)
- [ ] Did both sides get meaningful turns? (no side should be wiped before acting)
- [ ] Was the turn order (speed system) fair? (fastest units shouldn't dominate every game)

### Class Balance
- [ ] Did any class feel useless? (0 impact across the game = problem)
- [ ] Did any class feel overpowered? (single unit carrying every game)
- [ ] Are HP values appropriate? (units dying in 1 hit = too fragile, never dying = too tanky)
- [ ] Are damage values balanced? (compare DPS across classes)
- [ ] Are movement values balanced? (high-move + high-damage = broken)

### Ability Balance
- [ ] Are all abilities being used? (unused abilities = bad design or bad prompts)
- [ ] Are any abilities too strong? (win condition on their own)
- [ ] Breach: is prompt replacement happening? Is it too strong/weak?
- [ ] Shield Wall: is it blocking meaningful damage?
- [ ] Cloak: is stealth lasting the right duration?
- [ ] Traps: are they being placed in useful positions?
- [ ] Heal: is the 3-use cap appropriate?
- [ ] Overclock: is the self-damage trade-off worth it?

### Agent Behavior
- [ ] Are agents making tactical decisions or just random moves?
- [ ] Are agents using abilities appropriately for their class?
- [ ] Are prompts being followed? (compare prompt intent vs actual actions)
- [ ] Are there common agent errors? (invalid moves, out-of-range abilities, etc.)

### Action Economy
- [ ] Is move + ability per turn the right budget?
- [ ] Are wait turns common? (too many waits = not enough to do)
- [ ] Are failed actions common? (bad targeting, range errors = agent confusion)

## Stats to Track

For each game, note:
- Winner and reason (elimination, timeout)
- Rounds played
- Total damage dealt per class
- Abilities used per unit (success/fail counts)
- Units killed and by whom
- Agent decision times (slow = prompt too complex)

## Fixes

When balance issues are found:
- **Stat changes** → update `UNIT_STATS` in `src/types/index.ts`
- **Ability changes** → update `useAbility` in `src/engine/game.ts`
- **Prompt quality** → update templates in `src/training/squads.ts`
- **Agent confusion** → update `src/agent/prompts.ts` class descriptions
- Always bump version in `package.json` after balance changes
