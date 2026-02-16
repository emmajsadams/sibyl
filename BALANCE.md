# BALANCE.md — Balance Change Log

## Patch 0.2 — Post-Playtest (2026-02-15)

Based on 3 full playtests (2 API, 1 CLI agent). Key observations:
- Heal stalemate: Patch heals 3/turn, Striker deals 3/turn (or 2 through Fortify). Games stall.
- Specter dies in 1-2 hits. 4 HP vs 3 damage precision_shot = nearly instant death.
- Sentinel has no basic attack. AI keeps trying "attack" which doesn't exist.
- Breach never lands. Getting behind is too hard on a 6x6 grid, and Specter dies before reaching backline.
- Ironclad (Sentinel) never breaks the stalemate — just shield_walls forever.
- Cloaked units were still targetable by enemies (engine bug).

### Stat Changes

| Unit | Before | After | Reason |
|------|--------|-------|--------|
| Sentinel HP | 8 | 10 | Needs to survive longer as frontline |
| Specter HP | 4 | 5 | Dies too fast to precision_shot (3 dmg) |
| Striker HP | 6 | 5 | Slight nerf — Striker is strongest DPS |

### Ability Changes

| Change | Details | Reason |
|--------|---------|--------|
| **NEW: Sentinel melee attack** | All units can now basic attack adjacent enemies for 1 damage | AI kept trying to melee; every unit should have a basic option |
| **Patch heal: 3 → 2** | Heal amount reduced from 3 to 2 HP | Direct counter to heal stalemate. Striker (3 dmg) now out-damages healing. |
| **Patch heal limit** | Max 3 heals per game per Medic | Prevents infinite sustain in long games |
| **Precision Shot: can fire after moving at reduced damage** | 3 damage stationary, 2 damage after moving | More flexibility, lets Striker reposition without wasting turns |
| **Breach range: 1 → 2** | Can breach from 2 tiles away (still needs behind) | Getting adjacent AND behind is nearly impossible on 6x6 |
| **Specter: NEW Shadow Strike** | 2 damage melee attack. Bonus: doesn't break Cloak | Specter had zero damage output; now has a reason to exist in combat |

### Bug Fixes

| Fix | Details |
|-----|---------|
| **Cloaked units targetable** | Enemies could see and shoot cloaked units. Fixed visibility filter in `buildGameContext` to properly exclude cloaked enemies. |
| **Precision Shot moved check** | Track whether unit moved this turn. Apply damage penalty if moved. |

### Design Notes

- Heal stalemate was the #1 problem. Two fixes: reduce heal AND cap total heals.
- Specter getting Shadow Strike gives it actual combat value. Previously it was a walking liability.
- Basic attack for all units prevents the "Unknown ability: attack" errors.
- Striker HP nerf (6→5) offsets gaining fire-after-move. Glass cannon identity.
- Sentinel HP buff (8→10) makes Fortify more impactful (5 effective HP saved at full).

---

## Patch 0.1 — Initial Values (2026-02-14)

Original stats from SPEC.md.
- Sentinel: 8 HP, move 2, range 1
- Specter: 4 HP, move 3, range 1
- Oracle: 6 HP, move 2, range 4
- Striker: 6 HP, move 2, range 3
- Medic: 6 HP, move 2, range 1
- Vector: 6 HP, move 2, range 2
- Precision Shot: 3 damage, can't fire after moving
- Patch heal: 3 HP, unlimited
- Breach: adjacent + behind only
