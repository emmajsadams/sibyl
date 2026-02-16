import type {
  GameState,
  Unit,
  UnitClass,
  Side,
  Position,
  Trap,
  UnitAction,
  TurnAction,
  UnitStatus,
  GameContext,
  UnitView,
  UNIT_STATS,
} from "../types";
import { UNIT_STATS as Stats } from "../types";

const GRID_WIDTH = 6;
const GRID_HEIGHT = 6;

// === Factory ===

export function createUnit(
  id: string,
  name: string,
  unitClass: UnitClass,
  side: Side,
  position: Position,
  prompt: string
): Unit {
  const stats = Stats[unitClass];
  return {
    id,
    name,
    class: unitClass,
    side,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    position,
    movement: stats.movement,
    range: stats.range,
    facing: side === "player" ? "N" : "S",
    statusEffects: [],
    prompt,
  };
}

export function createGame(): GameState {
  return {
    grid: { width: GRID_WIDTH, height: GRID_HEIGHT },
    units: [],
    traps: [],
    turn: 0,
    phase: "setup",
    activesSide: "player",
    log: [],
  };
}

// === Queries ===

export function getUnit(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function getLivingUnits(state: GameState, side?: Side): Unit[] {
  return state.units.filter(
    (u) => u.hp > 0 && (side === undefined || u.side === side)
  );
}

export function getUnitStatus(unit: Unit): UnitStatus {
  if (unit.hp <= 0) return "dead";
  const ratio = unit.hp / unit.maxHp;
  if (ratio > 0.6) return "healthy";
  if (ratio > 0.25) return "wounded";
  return "critical";
}

export function isValidPosition(pos: Position): boolean {
  return pos.x >= 0 && pos.x < GRID_WIDTH && pos.y >= 0 && pos.y < GRID_HEIGHT;
}

export function isOccupied(state: GameState, pos: Position): boolean {
  return state.units.some(
    (u) => u.hp > 0 && u.position.x === pos.x && u.position.y === pos.y
  );
}

export function distance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function getUnitAt(state: GameState, pos: Position): Unit | undefined {
  return state.units.find(
    (u) => u.hp > 0 && u.position.x === pos.x && u.position.y === pos.y
  );
}

export function isBehind(attacker: Position, target: Unit): boolean {
  const dx = attacker.x - target.position.x;
  const dy = attacker.y - target.position.y;
  // If target faces N (+y), their back is south, attacker must be south (dy < 0)
  switch (target.facing) {
    case "N": return dy < 0; // back is south
    case "S": return dy > 0; // back is north
    case "E": return dx < 0; // back is west
    case "W": return dx > 0; // back is east
  }
}

function isCloaked(unit: Unit): boolean {
  return unit.statusEffects.some((e) => e.type === "cloaked");
}

function isAdjacentToVector(state: GameState, unit: Unit): boolean {
  return getLivingUnits(state).some(
    (u) =>
      u.class === "vector" &&
      u.side !== unit.side &&
      distance(u.position, unit.position) === 1
  );
}

// === Game Context (what the agent sees) ===

export function buildGameContext(
  state: GameState,
  unit: Unit,
  lastTurnLog?: string[]
): GameContext {
  const allies = getLivingUnits(state, unit.side)
    .filter((u) => u.id !== unit.id)
    .map((u) => unitToView(u, unit));

  const enemies = getLivingUnits(
    state,
    unit.side === "player" ? "opponent" : "player"
  )
    .filter((u) => !isCloaked(u))
    .map((u) => unitToView(u, unit));

  const ownTraps = state.traps
    .filter((t) => t.side === unit.side)
    .map((t) => t.position);

  return {
    unit,
    allies,
    enemies,
    traps: ownTraps,
    grid: state.grid,
    turn: state.turn,
    lastTurnActions: unit.class === "oracle" ? lastTurnLog : undefined,
  };
}

function unitToView(target: Unit, viewer: Unit): UnitView {
  return {
    id: target.id,
    name: target.name,
    class: target.class,
    position: target.position,
    status: getUnitStatus(target),
    hp:
      viewer.class === "medic" && target.side === viewer.side
        ? target.hp
        : undefined,
    facing: target.facing,
    cloaked: isCloaked(target),
  };
}

// === Placement ===

export function placeUnit(
  state: GameState,
  unit: Unit,
  pos: Position
): string | null {
  const validRows =
    unit.side === "player" ? [0, 1] : [GRID_HEIGHT - 2, GRID_HEIGHT - 1];
  if (!validRows.includes(pos.y)) return "Invalid row for placement";
  if (!isValidPosition(pos)) return "Position out of bounds";
  if (isOccupied(state, pos)) return "Position occupied";
  unit.position = pos;
  if (!state.units.includes(unit)) state.units.push(unit);
  return null;
}

// === Movement ===

export function moveUnit(
  state: GameState,
  unit: Unit,
  target: Position
): string | null {
  if (!isValidPosition(target)) return "Out of bounds";

  const maxMove = unit.statusEffects.some((e) => e.type === "suppressed")
    ? 1
    : unit.movement;
  const dist = distance(unit.position, target);
  if (dist > maxMove) return `Can only move ${maxMove} tiles`;
  if (isOccupied(state, target) && unit.class !== "specter")
    return "Position occupied";
  if (unit.class === "specter" && isOccupied(state, target))
    return "Specter can move through but not end on occupied tile";

  // Update facing based on movement direction
  const dx = target.x - unit.position.x;
  const dy = target.y - unit.position.y;
  if (Math.abs(dy) >= Math.abs(dx)) {
    unit.facing = dy > 0 ? "N" : "S";
  } else {
    unit.facing = dx > 0 ? "E" : "W";
  }

  unit.position = target;
  unit.movedThisTurn = true;

  // Check traps
  const trap = state.traps.find(
    (t) => t.position.x === target.x && t.position.y === target.y && t.side !== unit.side
  );
  if (trap) {
    unit.hp -= 2;
    state.traps = state.traps.filter((t) => t !== trap);
    state.log.push(`${unit.name} triggered a trap! (-2 HP)`);
  }

  // Remove fortified
  unit.statusEffects = unit.statusEffects.filter((e) => e.type !== "fortified");

  return null;
}

// === Abilities ===

export function useAbility(
  state: GameState,
  unit: Unit,
  ability: string,
  target?: Position,
  direction?: string,
  addendum?: string
): string | null {
  // Denial check
  if (isAdjacentToVector(state, unit)) {
    return "Cannot use abilities — adjacent to enemy Vector (Denial)";
  }

  // Break cloak on ability use (except Cloak itself and Shadow Strike)
  if (ability !== "cloak" && ability !== "shadow_strike") {
    unit.statusEffects = unit.statusEffects.filter((e) => e.type !== "cloaked");
  }

  switch (ability) {
    case "attack":
      return abilityBasicAttack(state, unit, target);
    case "shield_wall":
      return abilityShieldWall(state, unit, direction as any);
    case "intercept":
      return abilityIntercept(state, unit, target);
    case "breach":
      return abilityBreach(state, unit, target, addendum);
    case "cloak":
      return abilityCloak(unit);
    case "shadow_strike":
      return abilityShadowStrike(state, unit, target);
    case "scan":
      return abilityScan(state, unit, target);
    case "recalibrate":
      return abilityRecalibrate(state, unit, target, addendum);
    case "precision_shot":
      return abilityPrecisionShot(state, unit, target);
    case "suppressing_fire":
      return abilitySuppressingFire(state, unit, target);
    case "patch":
      return abilityPatch(state, unit, target);
    case "overclock":
      return abilityOverclock(state, unit, target);
    case "trap":
      return abilityTrap(state, unit, target);
    case "pulse":
      return abilityPulse(state, unit);
    default:
      return `Unknown ability: ${ability}`;
  }
}

function abilityBasicAttack(
  state: GameState,
  unit: Unit,
  target?: Position
): string | null {
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy || enemy.side === unit.side) return "No enemy at target";
  if (isCloaked(enemy)) return "Cannot target cloaked unit";
  if (distance(unit.position, enemy.position) > 1) return "Must be adjacent";
  const dmg = applyDamage(enemy, 1);
  state.log.push(`${unit.name} attacks ${enemy.name} (-${dmg} HP)`);
  return null;
}

function abilityShadowStrike(
  state: GameState,
  unit: Unit,
  target?: Position
): string | null {
  if (unit.class !== "specter") return "Only Specter can use Shadow Strike";
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy || enemy.side === unit.side) return "No enemy at target";
  if (distance(unit.position, enemy.position) > 1) return "Must be adjacent";
  const dmg = applyDamage(enemy, 2);
  state.log.push(`${unit.name} shadow strikes ${enemy.name} (-${dmg} HP)`);
  // Shadow Strike does NOT break cloak (unique to Specter)
  return null;
}

function abilityShieldWall(
  state: GameState,
  unit: Unit,
  direction?: "N" | "S" | "E" | "W"
): string | null {
  if (unit.class !== "sentinel") return "Only Sentinel can use Shield Wall";
  if (!direction) return "Must specify direction";
  unit.statusEffects.push({ type: "shieldWall", direction });
  state.log.push(`${unit.name} raises Shield Wall facing ${direction}`);
  return null;
}

function abilityIntercept(
  state: GameState,
  unit: Unit,
  target?: Position
): string | null {
  if (unit.class !== "sentinel") return "Only Sentinel can use Intercept";
  if (!target) return "Must specify ally position to protect";
  // Intercept moves sentinel to be adjacent to ally — simplified: move next to target
  const ally = getUnitAt(state, target);
  if (!ally || ally.side !== unit.side) return "No ally at target position";
  if (distance(unit.position, target) > 2) return "Ally out of range (max 2)";
  // Move adjacent
  const adjacent = [
    { x: target.x - 1, y: target.y },
    { x: target.x + 1, y: target.y },
    { x: target.x, y: target.y - 1 },
    { x: target.x, y: target.y + 1 },
  ].find((p) => isValidPosition(p) && !isOccupied(state, p));
  if (!adjacent) return "No free space adjacent to ally";
  unit.position = adjacent;
  unit.statusEffects.push({ type: "shieldWall", direction: unit.facing });
  state.log.push(`${unit.name} intercepts to protect ${ally.name}`);
  return null;
}

function abilityBreach(
  state: GameState,
  unit: Unit,
  target?: Position,
  addendum?: string
): string | null {
  if (unit.class !== "specter") return "Only Specter can use Breach";
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy || enemy.side === unit.side) return "No enemy at target";
  if (distance(unit.position, enemy.position) > 2) return "Must be within 2 tiles";
  if (!isBehind(unit.position, enemy)) return "Must be behind the target";
  if (!addendum) return "Must provide addendum text for Breach";
  enemy.breachAddendum = addendum;
  state.log.push(
    `${unit.name} breaches ${enemy.name}'s prompt!`
  );
  return null;
}

function abilityCloak(unit: Unit): string | null {
  if (unit.class !== "specter") return "Only Specter can use Cloak";
  // turnsLeft: 2 = lasts through this turn + enemy turn, expires at start of your next turn
  unit.statusEffects.push({ type: "cloaked", turnsLeft: 2 });
  return null;
}

function abilityScan(
  state: GameState,
  unit: Unit,
  target?: Position
): string | null {
  if (unit.class !== "oracle") return "Only Oracle can use Scan";
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy || enemy.side === unit.side) return "No enemy at target";
  if (distance(unit.position, enemy.position) > 4) return "Out of range (max 4)";
  // Scan result is returned to the agent — the CLI layer handles display
  state.log.push(
    `${unit.name} scans ${enemy.name}: "${enemy.prompt}${enemy.breachAddendum ? " [BREACHED: " + enemy.breachAddendum + "]" : ""}"`
  );
  return null;
}

function abilityRecalibrate(
  state: GameState,
  unit: Unit,
  target?: Position,
  addendum?: string
): string | null {
  if (unit.class !== "oracle") return "Only Oracle can use Recalibrate";
  if (!target) return "Must specify ally position";
  if (!addendum) return "Must provide addendum for recalibration";
  const ally = getUnitAt(state, target);
  if (!ally || ally.side !== unit.side) return "No ally at target";
  ally.breachAddendum = addendum; // reuse mechanism — temporary addendum
  state.log.push(`${unit.name} recalibrates ${ally.name}`);
  return null;
}

function abilityPrecisionShot(
  state: GameState,
  unit: Unit,
  target?: Position
): string | null {
  if (unit.class !== "striker") return "Only Striker can use Precision Shot";
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy || enemy.side === unit.side) return "No enemy at target";
  if (isCloaked(enemy)) return "Cannot target cloaked unit";
  const range =
    unit.range +
    (unit.statusEffects.some((e) => e.type === "fortified") ? 0 : 0) +
    (getLivingUnits(state).filter(
      (u) => u.side !== unit.side && distance(u.position, unit.position) === 1
    ).length === 0
      ? 1
      : 0); // High Ground passive
  if (distance(unit.position, enemy.position) > range)
    return "Out of range";
  const baseDmg = unit.movedThisTurn ? 2 : 3; // reduced damage after moving
  const dmg = applyDamage(enemy, baseDmg);
  state.log.push(`${unit.name} fires Precision Shot at ${enemy.name} (-${dmg} HP)${unit.movedThisTurn ? " [moved]" : ""}`);
  return null;
}

function abilitySuppressingFire(
  state: GameState,
  unit: Unit,
  target?: Position
): string | null {
  if (unit.class !== "striker") return "Only Striker can use Suppressing Fire";
  if (!target) return "Must specify target direction tile";
  // Hits target + one tile beyond in same line
  const dx = Math.sign(target.x - unit.position.x);
  const dy = Math.sign(target.y - unit.position.y);
  const tiles = [target, { x: target.x + dx, y: target.y + dy }];
  for (const tile of tiles) {
    const hit = getUnitAt(state, tile);
    if (hit && hit.side !== unit.side) {
      const dmg = applyDamage(hit, 1);
      hit.statusEffects.push({ type: "suppressed" });
      state.log.push(
        `${unit.name} suppresses ${hit.name} (-${dmg} HP, movement reduced)`
      );
    }
  }
  return null;
}

function abilityPatch(
  state: GameState,
  unit: Unit,
  target?: Position
): string | null {
  if (unit.class !== "medic") return "Only Medic can use Patch";
  if (!target) return "Must specify ally position";
  const ally = getUnitAt(state, target);
  if (!ally || ally.side !== unit.side) return "No ally at target";
  if (distance(unit.position, ally.position) > 1) return "Must be adjacent";
  const usedHeals = unit.healsUsed || 0;
  if (usedHeals >= 3) return "No heals remaining (max 3 per game)";
  const healed = Math.min(2, ally.maxHp - ally.hp);
  ally.hp += healed;
  unit.healsUsed = usedHeals + 1;
  state.log.push(`${unit.name} patches ${ally.name} (+${healed} HP) [${3 - usedHeals - 1} heals left]`);
  return null;
}

function abilityOverclock(
  state: GameState,
  unit: Unit,
  target?: Position
): string | null {
  if (unit.class !== "medic") return "Only Medic can use Overclock";
  if (!target) return "Must specify ally position";
  const ally = getUnitAt(state, target);
  if (!ally || ally.side !== unit.side) return "No ally at target";
  if (distance(unit.position, ally.position) > 1) return "Must be adjacent";
  ally.hp -= 1;
  ally.statusEffects.push({ type: "overclocked" });
  state.log.push(`${unit.name} overclocks ${ally.name} (-1 HP, double ability next turn)`);
  return null;
}

function abilityTrap(
  state: GameState,
  unit: Unit,
  target?: Position
): string | null {
  if (unit.class !== "vector") return "Only Vector can use Trap";
  if (!target) return "Must specify position";
  if (distance(unit.position, target) > 2) return "Out of range (max 2)";
  if (!isValidPosition(target)) return "Invalid position";
  if (isOccupied(state, target)) return "Position occupied";
  state.traps.push({ position: target, owner: unit.id, side: unit.side });
  state.log.push(`${unit.name} places a trap`);
  return null;
}

function abilityPulse(state: GameState, unit: Unit): string | null {
  if (unit.class !== "vector") return "Only Vector can use Pulse";
  const affected = state.units.filter(
    (u) => u.hp > 0 && u.id !== unit.id && distance(u.position, unit.position) <= 1
  );
  for (const target of affected) {
    const dmg = applyDamage(target, 1);
    state.log.push(`${unit.name}'s Pulse hits ${target.name} (-${dmg} HP)`);
  }
  return null;
}

// === Damage ===

function applyDamage(unit: Unit, amount: number): number {
  // Fortified = 50% damage reduction
  if (unit.statusEffects.some((e) => e.type === "fortified")) {
    amount = Math.ceil(amount / 2);
  }
  // Shield Wall check would go here (need attacker direction)
  unit.hp = Math.max(0, unit.hp - amount);
  return amount;
}

// === Turn Management ===

export function startPlay(state: GameState): void {
  state.phase = "play";
  state.turn = 1;
  state.activesSide = "player";
  state.log.push("=== Battle begins ===");
}

export function endTurn(state: GameState): void {
  // Clean up expiring effects
  const actingSide = state.activesSide;
  for (const unit of state.units) {
    unit.statusEffects = unit.statusEffects.filter((e) => {
      // Cloak only expires for the cloaking unit's own side
      if (e.type === "cloaked") {
        if (unit.side !== actingSide) return true; // keep — not their turn yet
        e.turnsLeft--;
        return e.turnsLeft > 0;
      }
      if (e.type === "suppressed") return false;
      if (e.type === "shieldWall") return false;
      if (e.type === "overclocked") return false;
      return true;
    });

    // Reset movement tracking
    unit.movedThisTurn = false;

    // Sentinel fortify: if didn't move (handled by checking if fortified was removed during move)
    if (unit.class === "sentinel" && unit.hp > 0) {
      // Re-add fortified at end of turn (will be removed if they move next turn)
      if (!unit.statusEffects.some((e) => e.type === "fortified")) {
        unit.statusEffects.push({ type: "fortified" });
      }
    }

    // Clear breach addendum after it's been used for one turn
    unit.breachAddendum = undefined;
  }

  // Switch sides
  if (state.activesSide === "player") {
    state.activesSide = "opponent";
  } else {
    state.activesSide = "player";
    state.turn++;
  }

  // Check win
  const playerAlive = getLivingUnits(state, "player").length;
  const opponentAlive = getLivingUnits(state, "opponent").length;
  if (playerAlive === 0) {
    state.phase = "ended";
    state.winner = "opponent";
    state.log.push("=== Opponent wins ===");
  } else if (opponentAlive === 0) {
    state.phase = "ended";
    state.winner = "player";
    state.log.push("=== Player wins ===");
  }
}
