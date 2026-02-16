import type { GameContext, Unit, UnitClass } from "../types";

const CLASS_DESCRIPTIONS: Record<UnitClass, string> = {
  sentinel: `SENTINEL (Tank) | 10HP, mv2, melee | Abilities: attack(1dmg,adj), shield_wall(block dmg to adj allies from dir NSEW), intercept(protect ally ≤2 tiles, uses move+ability) | Passive: Fortify(50% dmg reduction if didn't move)`,
  specter: `SPECTER (Infiltrator) | 5HP, mv3, melee | Abilities: shadow_strike(2dmg,adj,keeps cloak), breach(≤2 tiles,must be BEHIND enemy by facing,replaces target prompt—they obey YOU next turn), cloak(invis 3 turns,broken by attack/breach but NOT shadow_strike), attack(1dmg,adj,breaks cloak) | Passive: Ghost Step(move through enemies, can't end on them) | WARNING: cloak/breach blocked when adjacent to enemy Vector`,
  oracle: `ORACLE (Scanner) | 8HP, mv2, rng4 | Abilities: scan(reveal enemy prompt,rng4), recalibrate(give ally prompt addendum for next action), attack(1dmg,adj) | Passive: Foresight(see enemy actions last turn) | WARNING: scan blocked when adjacent to enemy Vector`,
  striker: `STRIKER (Ranged DPS) | 4HP, mv2, rng3 | Abilities: precision_shot(2dmg rng3,1dmg if moved,needs LoS), suppressing_fire(1dmg 2-tile line from target,slows hit enemies mv1), attack(1dmg,adj) | Passive: High Ground(+1 rng if no adj enemy) | WARNING: precision_shot blocked when adjacent to enemy Vector`,
  medic: `MEDIC (Healer) | 6HP, mv2, melee | Abilities: patch(heal adj ally 2HP,3 uses/game), overclock(adj ally gets 2 abilities next turn,takes 1dmg now), attack(1dmg,adj) | Passive: Triage(see exact ally HP) | WARNING: patch/overclock blocked when adjacent to enemy Vector`,
  vector: `VECTOR (Area Control) | 6HP, mv2, rng2 | Abilities: trap(invis mine on empty tile rng2,2dmg on step), pulse(1dmg ALL units within 1 tile), attack(1dmg,adj) | Passive: Denial(adj enemies can't use SOME abilities: cloak,breach,scan,precision_shot,trap,patch,overclock. Basic attacks/movement still work) | WARNING: trap blocked when adjacent to enemy Vector`,
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
    `R${ctx.round} | You: (${u.position.x},${u.position.y})→${u.facing} HP:${u.hp}/${u.maxHp} spd:${u.speed}`,
  ];

  if (u.statusEffects.length > 0) {
    lines.push(`Status: ${u.statusEffects.map((e) => e.type).join(", ")}`);
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
            const hp = a.hp !== undefined ? `HP:${a.hp}` : a.status;
            return `${a.name}(${a.class},spd${a.speed}) @(${a.position.x},${a.position.y})→${a.facing} ${hp}`;
          })
          .join(" | "),
    );
  }

  if (ctx.enemies.length > 0) {
    lines.push(
      "Enemies: " +
        ctx.enemies
          .map(
            (e) =>
              `${e.name}(${e.class},spd${e.speed}) @(${e.position.x},${e.position.y})→${e.facing} ${e.status}`,
          )
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
