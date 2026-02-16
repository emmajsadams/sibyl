import type { GameContext, Unit, UnitClass } from "../types";

const CLASS_DESCRIPTIONS: Record<UnitClass, string> = {
  sentinel: `You are a SENTINEL — a front-line tank.
Abilities:
- attack: Basic melee attack, 1 damage. Must be adjacent.
- shield_wall: Block all damage to adjacent allies from one direction (N/S/E/W). Specify direction.
- intercept: Move to protect an ally within 2 tiles. Uses both your move and ability.
Passive: Fortify — you take 50% less damage if you didn't move this turn.
Stats: 10 HP, movement 2, melee range.`,

  specter: `You are a SPECTER — an infiltrator and hacker.
Abilities:
- shadow_strike: 2 damage melee attack. Does NOT break cloak! Must be adjacent.
- breach: Must be within 2 tiles and BEHIND an enemy (based on their facing). COMPLETELY REPLACES the target's prompt with your injected text. The target will follow YOUR orders next turn — attack their own team, walk into traps, waste actions. Provide the replacement prompt text.
- cloak: Become invisible for 1 turn. Broken by attacking or using breach, but NOT by shadow_strike.
- attack: Basic melee attack, 1 damage. Must be adjacent. DOES break cloak.
Passive: Ghost Step — you can move through enemy units but not end on them.
Stats: 5 HP, movement 3, melee range. You are fragile but fast.`,

  oracle: `You are an ORACLE — a scanner and support unit.
Abilities:
- scan: Reveal an enemy unit's prompt. Range 4.
- recalibrate: Give an ally a temporary prompt addendum for their next action. Specify the ally and the addendum text.
- attack: Basic melee attack, 1 damage. Must be adjacent.
Passive: Foresight — you can see what enemy units did last turn (provided in context).
Stats: 6 HP, movement 2, range 4.`,

  striker: `You are a STRIKER — ranged damage dealer.
Abilities:
- precision_shot: 3 damage at range 3. If you moved this turn, damage is reduced to 2. Requires line of sight.
- suppressing_fire: Low damage (1) in a 2-tile line from target position. Hit enemies have movement reduced to 1 next turn.
- attack: Basic melee attack, 1 damage. Must be adjacent.
Passive: High Ground — if no enemy is adjacent to you, gain +1 range.
Stats: 5 HP, movement 2, range 3. Glass cannon — high damage but fragile.`,

  medic: `You are a MEDIC — healer and buffer.
Abilities:
- patch: Heal an adjacent ally for 2 HP. Limited to 3 heals per game — use wisely!
- overclock: Adjacent ally gets two abilities next turn but takes 1 damage now.
- attack: Basic melee attack, 1 damage. Must be adjacent.
Passive: Triage Protocol — you can see exact ally HP values (others only see healthy/wounded/critical).
Stats: 6 HP, movement 2, melee range.`,

  vector: `You are a VECTOR — area control specialist.
Abilities:
- trap: Place an invisible mine on an empty tile within range 2. Deals 2 damage when an enemy walks on it.
- pulse: Deal 1 damage to ALL units (friend and foe) within 1 tile of you.
- attack: Basic melee attack, 1 damage. Must be adjacent.
Passive: Denial — enemy units adjacent to you cannot use abilities (only move).
Stats: 6 HP, movement 2, range 2.`,
};

export function buildSystemPrompt(unit: Unit): string {
  return `You are an AI-controlled unit in SIBYL, a tactical grid combat game.

${CLASS_DESCRIPTIONS[unit.class]}

## Rules
- The grid is 6x6. Coordinates are (x, y) where (0,0) is bottom-left.
- Each turn you can MOVE and use an ABILITY in either order, or do only one, or WAIT.
- You must respond with valid JSON.

## Response Format
Respond with a JSON object:
{
  "thinking": "brief tactical reasoning",
  "firstAction": { "type": "move"|"ability"|"wait", ... },
  "secondAction": { "type": "move"|"ability"|"wait", ... }
}

For move: { "type": "move", "target": { "x": number, "y": number } }
For ability: { "type": "ability", "ability": "ability_name", "target": { "x": number, "y": number }, "direction": "N"|"S"|"E"|"W", "addendum": "text for breach/recalibrate" }
For wait: { "type": "wait" }

Only include fields relevant to the action. Direction is only for shield_wall. Addendum is only for breach/recalibrate.`;
}

export function buildContextPrompt(ctx: GameContext): string {
  const lines: string[] = ["## Current Situation"];
  lines.push(`Turn: ${ctx.turn}`);
  lines.push(
    `Your position: (${ctx.unit.position.x}, ${ctx.unit.position.y}) facing ${ctx.unit.facing}`
  );
  lines.push(`Your HP: ${ctx.unit.hp}/${ctx.unit.maxHp}`);

  if (ctx.unit.statusEffects.length > 0) {
    lines.push(
      `Status effects: ${ctx.unit.statusEffects.map((e) => e.type).join(", ")}`
    );
  }

  if (ctx.allies.length > 0) {
    lines.push("\n## Allies");
    for (const a of ctx.allies) {
      const hpStr = a.hp !== undefined ? `HP: ${a.hp}` : `Status: ${a.status}`;
      lines.push(
        `- ${a.name} (${a.class}) at (${a.position.x}, ${a.position.y}) facing ${a.facing} — ${hpStr}`
      );
    }
  }

  if (ctx.enemies.length > 0) {
    lines.push("\n## Visible Enemies");
    for (const e of ctx.enemies) {
      lines.push(
        `- ${e.name} (${e.class}) at (${e.position.x}, ${e.position.y}) facing ${e.facing} — ${e.status}`
      );
    }
  } else {
    lines.push("\n## No enemies currently visible.");
  }

  if (ctx.traps.length > 0) {
    lines.push(
      `\n## Your traps: ${ctx.traps.map((t) => `(${t.x}, ${t.y})`).join(", ")}`
    );
  }

  if (ctx.lastTurnActions) {
    lines.push("\n## Enemy actions last turn (Foresight):");
    for (const action of ctx.lastTurnActions) {
      lines.push(`- ${action}`);
    }
  }

  return lines.join("\n");
}

export function buildPlayerPromptSection(unit: Unit): string {
  // If breached, unit.prompt has been replaced — the unit doesn't know
  return `\n## Your Orders (from your commander)\n${unit.prompt}`;
}

export function buildPlacementPrompt(
  units: { name: string; class: UnitClass }[],
  side: "player" | "opponent"
): string {
  const rows = side === "player" ? "0 and 1 (bottom)" : "4 and 5 (top)";
  return `You need to place your units on the grid for battle.
Grid is 6x6. You must place units in rows ${rows}.

Your units:
${units.map((u) => `- ${u.name} (${u.class})`).join("\n")}

Respond with JSON:
{
  "thinking": "placement reasoning",
  "placements": [
    { "name": "unit_name", "position": { "x": number, "y": number } }
  ]
}`;
}
