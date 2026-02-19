import { UNIT_STATS, type GameContext, type Unit, type UnitClass } from "../types";

const CLASS_DESCRIPTIONS: Record<UnitClass, string> = {
  sentinel: `SENTINEL (Tank) | 10HP, mv2, melee | Abilities: attack(1dmg, range:adjacent only), shield_wall(block dmg to adj allies from dir NSEW, range:adjacent ally), intercept(protect ally, range:≤2 tiles, uses move+ability) | Passive: Fortify(50% dmg reduction if didn't move)`,
  specter: `SPECTER (Infiltrator) | 5HP, mv3, melee | Abilities: shadow_strike(2dmg, range:adjacent only, keeps cloak), breach(range:≤2 tiles, must be BEHIND enemy by facing, replaces target prompt—they obey YOU next turn), cloak(self-only, invis 3 turns, broken by attack/breach but NOT shadow_strike — USE ONLY ON YOUR FIRST TURN OF THE GAME, not every round), attack(1dmg, range:adjacent only, breaks cloak) | Passive: Ghost Step(move through enemies, can't end on them) | WARNING: cloak/breach blocked when adjacent to enemy Vector`,
  oracle: `ORACLE (Scanner) | 8HP, mv2, rng4 | Abilities: scan, recalibrate, attack — ONLY these three, no others exist. scan(reveal enemy prompt AND deal 1dmg, range:≤4 tiles — target MUST be within 4 tiles or scan fails), recalibrate(give ally prompt addendum, range:adjacent only), attack(1dmg, range:adjacent only) | Passive: Foresight(see enemy actions last turn) | WARNING: scan blocked when adjacent to enemy Vector`,
  striker: `STRIKER (Ranged DPS) | 4HP, mv2, rng3 | Abilities: precision_shot(2dmg, range:≤3 tiles, 1dmg if moved, needs LoS), suppressing_fire(1dmg 2-tile line from target, range:≤3 tiles, slows hit enemies mv1), attack(1dmg, range:adjacent only) | Passive: High Ground(+1 rng if no adj enemy) | WARNING: precision_shot blocked when adjacent to enemy Vector`,
  medic: `MEDIC (Healer) | 6HP, mv2, melee | Abilities: patch(heal adj ally 2HP, range:adjacent only, 3 uses/game — ONLY heal wounded allies with HP < maxHP, never heal full-HP allies), overclock(adj ally gets 2 abilities next turn, range:adjacent only, takes 1dmg now), attack(1dmg, range:adjacent only) | Passive: Triage(see exact ally HP) | WARNING: patch/overclock blocked when adjacent to enemy Vector`,
  vector: `VECTOR (Area Control) | 6HP, mv2, rng2 | Abilities: trap(invis mine on empty tile, range:≤2 tiles, 2dmg on step), pulse(1dmg ALL units within 1 tile, range:1 tile AoE), attack(1dmg, range:adjacent only) | Passive: Denial(adj enemies can't use SOME abilities: cloak,breach,scan,precision_shot,trap,patch,overclock. Basic attacks/movement still work) | WARNING: trap blocked when adjacent to enemy Vector`,
};

export function buildSystemPrompt(unit: Unit): string {
  return `SIBYL tactical AI. You control one unit on a 6x6 grid. Coords (x,y), (0,0)=bottom-left.

${CLASS_DESCRIPTIONS[unit.class]}

Rules: Each turn you may MOVE + ABILITY (either order), or just one, or WAIT.

Response format — JSON object:
{
  "thinking": "brief tactical reasoning",
  "firstAction": { "type": "move"|"ability"|"wait", ... },
  "secondAction": { "type": "move"|"ability"|"wait", ... }
}
Move: { "type": "move", "target": { "x": N, "y": N } }
Ability: { "type": "ability", "ability": "name", "target": { "x": N, "y": N }, "direction": "N|S|E|W", "addendum": "text" }
Wait: { "type": "wait" }
Only include relevant fields. direction=shield_wall only. addendum=breach/recalibrate only.`;
}

export function buildContextPrompt(ctx: GameContext): string {
  const u = ctx.unit;
  const lines: string[] = [
    `=== ROUND ${ctx.round} === | You: (${u.position.x},${u.position.y})→${u.facing} HP:${u.hp}/${u.maxHp} spd:${u.speed}`,
  ];

  if (u.statusEffects.length > 0) {
    lines.push(`Status: ${u.statusEffects.map((e) => e.type).join(", ")}`);
  }

  // === Resource/cooldown tracking ===
  if (u.class === "medic") {
    const used = u.healsUsed ?? 0;
    const remaining = 3 - used;
    lines.push(
      `Heals remaining: ${remaining}/3${remaining === 0 ? " — PATCH UNAVAILABLE, limit reached, do NOT attempt" : ""}`,
    );
  }

  if (u.class === "specter") {
    const isCloaked = u.statusEffects.some((e) => e.type === "cloaked");
    // Breach tracking
    const breachesUsed = u.breachesUsed ?? 0;
    const breachCooldown = u.breachCooldown ?? 0;
    const breachCapped = breachesUsed >= 2;
    lines.push(
      `Breaches used: ${breachesUsed}/2${breachCapped ? " — BREACH UNAVAILABLE — limit reached, do NOT attempt" : ""}`,
    );
    if (breachCooldown > 0 && !breachCapped) {
      lines.push(`Breach cooldown: ${breachCooldown} turns remaining`);
    } else if (!breachCapped) {
      lines.push(`Breach cooldown: ready`);
    }
    // Cloak tips
    if (ctx.round === 1 && !isCloaked) {
      lines.push(`TIP: This is round 1 — good time to cloak.`);
    } else if (ctx.round > 1 && isCloaked) {
      lines.push(
        `TIP: Already cloaked. Do NOT re-cloak. Use your cloak to get behind enemies for breach/shadow_strike.`,
      );
    } else if (ctx.round > 1 && !isCloaked) {
      lines.push(
        `TIP: Round ${ctx.round} — do NOT cloak again unless tactically critical. Focus on offense.`,
      );
    }
  }

  // Overclock status
  if (u.statusEffects.some((e) => e.type === "overclocked")) {
    lines.push(`[OVERCLOCKED — you have 2 ability uses this turn]`);
  }

  // Cloak status (for any unit that might have it)
  const cloakEffect = u.statusEffects.find((e) => e.type === "cloaked") as
    | { type: "cloaked"; turnsLeft: number }
    | undefined;
  if (cloakEffect) {
    lines.push(`Cloak: ${cloakEffect.turnsLeft} turns remaining`);
  }

  // Fortified status
  if (u.statusEffects.some((e) => e.type === "fortified")) {
    lines.push(`[FORTIFIED — 50% damage reduction active]`);
  }

  // Suppressed status
  if (u.statusEffects.some((e) => e.type === "suppressed")) {
    lines.push(`[SUPPRESSED — movement reduced to 1]`);
  }

  if (ctx.turnOrder && ctx.turnOrder.length > 0) {
    const order = ctx.turnOrder.map((e) => {
      const side = e.side === u.side ? "A" : "E";
      const mark = e.id === u.id ? "*" : e.hasActed ? "✓" : "·";
      return `${mark}${e.name}(${e.class},${side},spd${e.speed})`;
    });
    lines.push(`Order: ${order.join(" ")}`);
  }

  if (ctx.allies.length > 0) {
    lines.push(
      "Allies: " +
        ctx.allies
          .map((a) => {
            const hp =
              a.hp !== undefined
                ? `HP:${a.hp}/${
                    u.class === "medic"
                      ? (() => {
                          const stats = UNIT_STATS[a.class];
                          return stats.maxHp;
                        })()
                      : "?"
                  }`
                : a.status;
            const dist =
              Math.abs(a.position.x - u.position.x) + Math.abs(a.position.y - u.position.y);
            let extra = "";
            if (u.class === "medic" && a.hp !== undefined) {
              const maxHp = UNIT_STATS[a.class].maxHp;
              const wounded = a.hp < maxHp;
              extra = wounded ? ` [WOUNDED, needs heal]` : ` [FULL HP, do NOT heal]`;
              if (dist > 1) extra += ` [not adjacent, dist=${dist}]`;
            }
            return `${a.name}(${a.class},spd${a.speed}) @(${a.position.x},${a.position.y})→${a.facing} ${hp}${extra}`;
          })
          .join(" | "),
    );
  }

  // Denial zone warnings — check if we're adjacent to any enemy Vector
  const enemyVectors = ctx.enemies.filter((e) => e.class === "vector");
  for (const v of enemyVectors) {
    const dist = Math.abs(v.position.x - u.position.x) + Math.abs(v.position.y - u.position.y);
    if (dist <= 1) {
      lines.push(
        `[⚠ WARNING: Adjacent to ${v.name}'s DENIAL zone — abilities may be BLOCKED (only basic attack/movement work)]`,
      );
    } else if (dist <= 3) {
      lines.push(
        `[CAUTION: ${v.name}(vector) is ${dist} tiles away — avoid moving adjacent or abilities will be blocked]`,
      );
    }
  }

  if (ctx.enemies.length > 0) {
    lines.push(
      "Enemies: " +
        ctx.enemies
          .map((e) => {
            const dist =
              Math.abs(e.position.x - u.position.x) + Math.abs(e.position.y - u.position.y);
            let extra = "";
            if (u.class === "oracle") {
              // Check if already scanned
              if (ctx.scannedEnemies && ctx.scannedEnemies[e.id]) {
                extra = ` [Already scanned — prompt known: "${ctx.scannedEnemies[e.id]}"]`;
              } else {
                extra =
                  dist <= 4
                    ? ` [in scan range, dist=${dist}]`
                    : ` [OUT OF SCAN RANGE, dist=${dist} > 4]`;
              }
            } else {
              extra = ` [dist=${dist}]`;
            }
            // Warn about Vector denial radius
            if (e.class === "vector") {
              extra +=
                dist <= 1 ? ` [DENIAL ACTIVE — you are adjacent]` : ` [denial range: adjacent]`;
            }
            return `${e.name}(${e.class},spd${e.speed}) @(${e.position.x},${e.position.y})→${e.facing} ${e.status}${extra}`;
          })
          .join(" | "),
    );
  } else {
    lines.push("No enemies visible.");
  }

  if (ctx.traps.length > 0) {
    lines.push(`Traps: ${ctx.traps.map((t) => `(${t.x},${t.y})`).join(" ")}`);
  }

  if (ctx.lastTurnActions) {
    lines.push("Foresight: " + ctx.lastTurnActions.join("; "));
  }

  return lines.join("\n");
}

export function buildPlayerPromptSection(unit: Unit): string {
  return `\nOrders: ${unit.prompt}`;
}

export function buildPlacementPrompt(
  units: { name: string; class: UnitClass }[],
  side: "player" | "opponent",
): string {
  const rows = side === "player" ? "0-1 (bottom)" : "4-5 (top)";
  return `Place units on 6x6 grid, rows ${rows}.
Units: ${units.map((u) => `${u.name}(${u.class})`).join(", ")}

Respond JSON:
{
  "thinking": "placement reasoning",
  "placements": [{ "name": "unit_name", "position": { "x": N, "y": N } }]
}`;
}
