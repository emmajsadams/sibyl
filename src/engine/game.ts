import type {
  GameState,
  Unit,
  UnitClass,
  Side,
  Position,
  UnitStatus,
  GameContext,
  UnitView,
} from "../types";
import { UNIT_STATS as Stats, BALANCE } from "../types";
import { emit } from "../training/emitter";
import { TrainingRecorder } from "../training/recorder";

// Read dynamically so --grid override works at runtime
const GRID_WIDTH = () => BALANCE.grid.width;
const GRID_HEIGHT = () => BALANCE.grid.height;

// === Factory ===

export function createUnit(
  id: string,
  name: string,
  unitClass: UnitClass,
  side: Side,
  position: Position,
  prompt: string,
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
    speed: stats.speed,
    facing: side === "player" ? "N" : "S",
    statusEffects: [],
    prompt,
  };
}

export function createGame(): GameState {
  return {
    grid: { width: GRID_WIDTH(), height: GRID_HEIGHT() },
    units: [],
    traps: [],
    round: 0,
    turn: 0,
    phase: "setup",
    log: [],
    turnStack: [],
    currentTurnStack: [],
    scanHistory: {},
  };
}

// === Queries ===

export function getUnit(state: GameState, id: string): Unit | undefined {
  return state.units.find((u) => u.id === id);
}

export function getLivingUnits(state: GameState, side?: Side): Unit[] {
  return state.units.filter((u) => u.hp > 0 && (side === undefined || u.side === side));
}

export function getUnitStatus(unit: Unit): UnitStatus {
  if (unit.hp <= 0) return "dead";
  const ratio = unit.hp / unit.maxHp;
  if (ratio > 0.6) return "healthy";
  if (ratio > 0.25) return "wounded";
  return "critical";
}

export function isValidPosition(pos: Position): boolean {
  return pos.x >= 0 && pos.x < GRID_WIDTH() && pos.y >= 0 && pos.y < GRID_HEIGHT();
}

export function isOccupied(state: GameState, pos: Position): boolean {
  return state.units.some((u) => u.hp > 0 && u.position.x === pos.x && u.position.y === pos.y);
}

export function distance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function getUnitAt(state: GameState, pos: Position): Unit | undefined {
  return state.units.find((u) => u.hp > 0 && u.position.x === pos.x && u.position.y === pos.y);
}

export function isBehind(attacker: Position, target: Unit): boolean {
  const dx = attacker.x - target.position.x;
  const dy = attacker.y - target.position.y;
  // If target faces N (+y), their back is south, attacker must be south (dy < 0)
  switch (target.facing) {
    case "N":
      return dy < 0; // back is south
    case "S":
      return dy > 0; // back is north
    case "E":
      return dx < 0; // back is west
    case "W":
      return dx > 0; // back is east
  }
}

function isCloaked(unit: Unit): boolean {
  return unit.statusEffects.some((e) => e.type === "cloaked");
}

function isAdjacentToVector(state: GameState, unit: Unit): boolean {
  return getLivingUnits(state).some(
    (u) =>
      u.class === "vector" && u.side !== unit.side && distance(u.position, unit.position) === 1,
  );
}

// === Turn Order ===

/** Build turn order: sort by speed descending, break ties randomly */
export function buildTurnStack(state: GameState): string[] {
  const living = getLivingUnits(state);
  // Shuffle first to randomize tie-breaking
  const shuffled = [...living].sort(() => Math.random() - 0.5);
  // Then stable-sort by speed descending
  shuffled.sort((a, b) => b.speed - a.speed);
  return shuffled.map((u) => u.id);
}

/** Get the next unit to act, skipping dead units */
export function getNextUnit(state: GameState): Unit | null {
  while (state.currentTurnStack.length > 0) {
    const nextId = state.currentTurnStack[0]!;
    const unit = getUnit(state, nextId);
    if (unit && unit.hp > 0) {
      state.activeUnit = nextId;
      return unit;
    }
    // Dead unit — skip
    state.currentTurnStack.shift();
  }
  return null;
}

/** Called after a unit finishes acting */
export function unitActed(state: GameState): void {
  state.currentTurnStack.shift();
  state.activeUnit = undefined;
}

// === Game Context (what the agent sees) ===

export function buildGameContext(
  state: GameState,
  unit: Unit,
  lastRoundLog?: string[],
): GameContext {
  const allies = getLivingUnits(state, unit.side)
    .filter((u) => u.id !== unit.id)
    .map((u) => unitToView(u, unit));

  const enemies = getLivingUnits(state, unit.side === "player" ? "opponent" : "player")
    .filter((u) => !isCloaked(u))
    .map((u) => unitToView(u, unit));

  const ownTraps = state.traps.filter((t) => t.side === unit.side).map((t) => t.position);

  // Build turn order info — who has acted and who hasn't
  const actedIds = new Set(state.turnStack.filter((id) => !state.currentTurnStack.includes(id)));
  const turnOrder = state.turnStack
    .map((id) => {
      const u = getUnit(state, id);
      return {
        id,
        name: u?.name || "?",
        class: u?.class || ("sentinel" as UnitClass),
        side: u?.side || ("player" as Side),
        speed: u?.speed || 1,
        hasActed: actedIds.has(id),
      };
    })
    .filter((u) => {
      const unit2 = getUnit(state, u.id);
      return unit2 && unit2.hp > 0;
    });

  return {
    unit,
    allies,
    enemies,
    traps: ownTraps,
    grid: state.grid,
    turn: state.round, // compat
    round: state.round,
    turnOrder,
    lastTurnActions: unit.class === "oracle" ? lastRoundLog : undefined,
    scannedEnemies: unit.class === "oracle" ? (state.scanHistory[unit.id] ?? {}) : undefined,
  };
}

function unitToView(target: Unit, viewer: Unit): UnitView {
  return {
    id: target.id,
    name: target.name,
    class: target.class,
    position: target.position,
    status: getUnitStatus(target),
    hp: viewer.class === "medic" && target.side === viewer.side ? target.hp : undefined,
    facing: target.facing,
    cloaked: isCloaked(target),
    speed: target.speed,
  };
}

// === Placement ===

export function placeUnit(state: GameState, unit: Unit, pos: Position): string | null {
  const validRows = unit.side === "player" ? [0, 1] : [GRID_HEIGHT() - 2, GRID_HEIGHT() - 1];
  if (!validRows.includes(pos.y)) return "Invalid row for placement";
  if (!isValidPosition(pos)) return "Position out of bounds";
  if (isOccupied(state, pos)) return "Position occupied";
  unit.position = pos;
  if (!state.units.includes(unit)) state.units.push(unit);
  emit({
    type: "unit_placed",
    unitId: unit.id,
    side: unit.side,
    class: unit.class,
    position: { ...pos },
  });
  return null;
}

// === Movement ===

export function moveUnit(state: GameState, unit: Unit, target: Position): string | null {
  if (!isValidPosition(target)) return "Out of bounds";

  const maxMove = unit.statusEffects.some((e) => e.type === "suppressed") ? 1 : unit.movement;
  const dist = distance(unit.position, target);
  if (dist > maxMove) return `Can only move ${maxMove} tiles`;
  if (isOccupied(state, target) && unit.class !== "specter") return "Position occupied";
  if (unit.class === "specter" && isOccupied(state, target))
    return "Specter can move through but not end on occupied tile";

  // Update facing based on movement direction
  const from = { ...unit.position };
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
    (t) => t.position.x === target.x && t.position.y === target.y && t.side !== unit.side,
  );
  let triggeredTrap = false;
  if (trap) {
    unit.hp -= BALANCE.abilities.trap.damage;
    state.traps = state.traps.filter((t) => t !== trap);
    state.log.push(`${unit.name} triggered a trap! (-${BALANCE.abilities.trap.damage} HP)`);
    triggeredTrap = true;
    emit({
      type: "trap_triggered",
      unitId: unit.id,
      position: { ...target },
      damage: BALANCE.abilities.trap.damage,
      unitHpAfter: unit.hp,
    });
    if (unit.hp <= 0) {
      emit({ type: "unit_killed", unitId: unit.id, killerId: trap.owner, ability: "trap" });
    }
  }

  emit({
    type: "unit_moved",
    unitId: unit.id,
    from,
    to: { ...target },
    newFacing: unit.facing,
    triggeredTrap,
    trapDamage: triggeredTrap ? BALANCE.abilities.trap.damage : undefined,
  });

  // Remove fortified
  if (unit.statusEffects.some((e) => e.type === "fortified")) {
    unit.statusEffects = unit.statusEffects.filter((e) => e.type !== "fortified");
    emit({ type: "status_removed", unitId: unit.id, effectType: "fortified", reason: "moved" });
  }

  return null;
}

// === Abilities ===

export function useAbility(
  state: GameState,
  unit: Unit,
  ability: string,
  target?: Position,
  direction?: string,
  addendum?: string,
): string | null {
  // Denial check - only blocks specific abilities, not movement or basic attacks
  const deniedAbilities = [
    "cloak",
    "breach",
    "scan",
    "precision_shot",
    "trap",
    "patch",
    "overclock",
  ];
  if (deniedAbilities.includes(ability) && isAdjacentToVector(state, unit)) {
    const blocker = getLivingUnits(state).find(
      (u) =>
        u.class === "vector" && u.side !== unit.side && distance(u.position, unit.position) === 1,
    );
    emit({
      type: "denial_blocked",
      unitId: unit.id,
      blockedAbility: ability,
      vectorId: blocker?.id || "unknown",
    });
    return `Cannot use ${ability} — adjacent to enemy Vector (Denial)`;
  }

  // Break cloak on ability use (except Cloak itself and Shadow Strike)
  if (ability !== "cloak" && ability !== "shadow_strike") {
    if (unit.statusEffects.some((e) => e.type === "cloaked")) {
      unit.statusEffects = unit.statusEffects.filter((e) => e.type !== "cloaked");
      emit({
        type: "status_removed",
        unitId: unit.id,
        effectType: "cloaked",
        reason: "ability_break",
      });
    }
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

function abilityBasicAttack(state: GameState, unit: Unit, target?: Position): string | null {
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy) return "No unit at target";
  if (enemy.id === unit.id) return "Cannot attack self";
  if (isCloaked(enemy)) return "Cannot target cloaked unit";
  if (distance(unit.position, enemy.position) > 1) return "Must be adjacent";
  const dmg = applyDamage(enemy, BALANCE.abilities.attack.damage);
  const friendly = enemy.side === unit.side;
  state.log.push(
    `${unit.name} attacks ${enemy.name} (-${dmg} HP)${friendly ? " [FRIENDLY FIRE]" : ""}`,
  );
  emit({
    type: "damage_dealt",
    sourceId: unit.id,
    targetId: enemy.id,
    amount: dmg,
    ability: "attack",
    targetHpAfter: enemy.hp,
  });
  if (enemy.hp <= 0)
    emit({ type: "unit_killed", unitId: enemy.id, killerId: unit.id, ability: "attack" });
  return null;
}

function abilityShadowStrike(state: GameState, unit: Unit, target?: Position): string | null {
  if (unit.class !== "specter") return "Only Specter can use Shadow Strike";
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy || enemy.side === unit.side) return "No enemy at target";
  if (distance(unit.position, enemy.position) > 1) return "Must be adjacent";
  const dmg = applyDamage(enemy, BALANCE.abilities.shadowStrike.damage);
  state.log.push(`${unit.name} shadow strikes ${enemy.name} (-${dmg} HP)`);
  emit({
    type: "damage_dealt",
    sourceId: unit.id,
    targetId: enemy.id,
    amount: dmg,
    ability: "shadow_strike",
    targetHpAfter: enemy.hp,
  });
  if (enemy.hp <= 0)
    emit({ type: "unit_killed", unitId: enemy.id, killerId: unit.id, ability: "shadow_strike" });
  // Shadow Strike does NOT break cloak (unique to Specter)
  return null;
}

function abilityShieldWall(
  state: GameState,
  unit: Unit,
  direction?: "N" | "S" | "E" | "W",
): string | null {
  if (unit.class !== "sentinel") return "Only Sentinel can use Shield Wall";
  if (!direction) return "Must specify direction";
  const effect = { type: "shieldWall" as const, direction };
  unit.statusEffects.push(effect);
  state.log.push(`${unit.name} raises Shield Wall facing ${direction}`);
  emit({ type: "status_applied", unitId: unit.id, effect, source: "shield_wall" });
  return null;
}

function abilityIntercept(state: GameState, unit: Unit, target?: Position): string | null {
  if (unit.class !== "sentinel") return "Only Sentinel can use Intercept";
  if (!target) return "Must specify ally position to protect";
  const ally = getUnitAt(state, target);
  if (!ally || ally.side !== unit.side) return "No ally at target position";
  if (distance(unit.position, target) > 2) return "Ally out of range (max 2)";
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
  addendum?: string,
): string | null {
  if (unit.class !== "specter") return "Only Specter can use Breach";
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy || enemy.side === unit.side) return "No enemy at target";
  if (distance(unit.position, enemy.position) > BALANCE.abilities.breach.range)
    return `Must be within ${BALANCE.abilities.breach.range} tiles`;
  if (!isBehind(unit.position, enemy)) return "Must be behind the target";
  if (!addendum) return "Must provide addendum text for Breach";
  // Cap: Specter can breach at most N times per game
  const breachCount = unit.breachesUsed ?? 0;
  if (breachCount >= BALANCE.abilities.breach.maxUses)
    return `Breach limit reached (max ${BALANCE.abilities.breach.maxUses} per game)`;
  // Cooldown between uses
  if ((unit.breachCooldown ?? 0) > 0)
    return `Breach on cooldown (${unit.breachCooldown} turns remaining)`;
  // Breach replaces the target's prompt — store original for restoration
  const oldPrompt = enemy.prompt;
  if (!enemy.originalPrompt) enemy.originalPrompt = oldPrompt;
  enemy.prompt = addendum;
  enemy.breachTurnsLeft = BALANCE.abilities.breach.duration;
  unit.breachesUsed = breachCount + 1;
  unit.breachCooldown = BALANCE.abilities.breach.cooldown;
  state.log.push(`${unit.name} breaches ${enemy.name}'s prompt! (replaced, fades in 3 turns)`);
  emit({ type: "breach", attackerId: unit.id, targetId: enemy.id, oldPrompt, newPrompt: addendum });
  return null;
}

function abilityCloak(unit: Unit): string | null {
  if (unit.class !== "specter") return "Only Specter can use Cloak";
  const effect = { type: "cloaked" as const, turnsLeft: BALANCE.abilities.cloak.duration };
  unit.statusEffects.push(effect);
  emit({ type: "status_applied", unitId: unit.id, effect, source: "cloak" });
  return null;
}

function abilityScan(state: GameState, unit: Unit, target?: Position): string | null {
  if (unit.class !== "oracle") return "Only Oracle can use Scan";
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy || enemy.side === unit.side) return "No enemy at target";
  if (distance(unit.position, enemy.position) > 4) return "Out of range (max 4)";
  const prompt = enemy.prompt + (enemy.originalPrompt ? " [BREACHED — original overwritten]" : "");
  // Oracle scan deals minor damage (disorienting effect)
  const scanDmg = applyDamage(enemy, BALANCE.abilities.scan.damage);
  state.log.push(`${unit.name} scans ${enemy.name} (-${scanDmg} HP): "${prompt}"`);
  // Track scan history
  if (!state.scanHistory) state.scanHistory = {};
  if (!state.scanHistory[unit.id]) state.scanHistory[unit.id] = {};
  state.scanHistory[unit.id]![enemy.id] = prompt;
  return null;
}

function abilityRecalibrate(
  state: GameState,
  unit: Unit,
  target?: Position,
  addendum?: string,
): string | null {
  if (unit.class !== "oracle") return "Only Oracle can use Recalibrate";
  if (!target) return "Must specify ally position";
  if (!addendum) return "Must provide addendum for recalibration";
  const ally = getUnitAt(state, target);
  if (!ally || ally.side !== unit.side) return "No ally at target";
  // Recalibrate appends to prompt (buff, not replacement)
  ally.prompt = ally.prompt + "\n" + addendum;
  state.log.push(`${unit.name} recalibrates ${ally.name}`);
  return null;
}

function abilityPrecisionShot(state: GameState, unit: Unit, target?: Position): string | null {
  if (unit.class !== "striker") return "Only Striker can use Precision Shot";
  if (!target) return "Must specify target";
  const enemy = getUnitAt(state, target);
  if (!enemy) return "No unit at target";
  if (enemy.id === unit.id) return "Cannot target self";
  if (isCloaked(enemy)) return "Cannot target cloaked unit";
  const range = unit.range; // High Ground passive removed for balance (v0.5.1)
  if (distance(unit.position, enemy.position) > range) return "Out of range";
  const baseDmg = unit.movedThisTurn
    ? BALANCE.abilities.precisionShot.movedDamage
    : BALANCE.abilities.precisionShot.damage;
  const dmg = applyDamage(enemy, baseDmg);
  const friendly = enemy.side === unit.side;
  state.log.push(
    `${unit.name} fires Precision Shot at ${enemy.name} (-${dmg} HP)${unit.movedThisTurn ? " [moved]" : ""}${friendly ? " [FRIENDLY FIRE]" : ""}`,
  );
  emit({
    type: "damage_dealt",
    sourceId: unit.id,
    targetId: enemy.id,
    amount: dmg,
    ability: "precision_shot",
    targetHpAfter: enemy.hp,
  });
  if (enemy.hp <= 0)
    emit({ type: "unit_killed", unitId: enemy.id, killerId: unit.id, ability: "precision_shot" });
  return null;
}

function abilitySuppressingFire(state: GameState, unit: Unit, target?: Position): string | null {
  if (unit.class !== "striker") return "Only Striker can use Suppressing Fire";
  if (!target) return "Must specify target direction tile";
  const dx = Math.sign(target.x - unit.position.x);
  const dy = Math.sign(target.y - unit.position.y);
  const tiles = [target, { x: target.x + dx, y: target.y + dy }];
  for (const tile of tiles) {
    const hit = getUnitAt(state, tile);
    if (hit && hit.id !== unit.id) {
      const dmg = applyDamage(hit, BALANCE.abilities.suppressingFire.damage);
      hit.statusEffects.push({ type: "suppressed" });
      const friendly = hit.side === unit.side;
      state.log.push(
        `${unit.name} suppresses ${hit.name} (-${dmg} HP, movement reduced)${friendly ? " [FRIENDLY FIRE]" : ""}`,
      );
      emit({
        type: "damage_dealt",
        sourceId: unit.id,
        targetId: hit.id,
        amount: dmg,
        ability: "suppressing_fire",
        targetHpAfter: hit.hp,
      });
      emit({
        type: "status_applied",
        unitId: hit.id,
        effect: { type: "suppressed" },
        source: "suppressing_fire",
      });
      if (hit.hp <= 0)
        emit({
          type: "unit_killed",
          unitId: hit.id,
          killerId: unit.id,
          ability: "suppressing_fire",
        });
    }
  }
  return null;
}

function abilityPatch(state: GameState, unit: Unit, target?: Position): string | null {
  if (unit.class !== "medic") return "Only Medic can use Patch";
  if (!target) return "Must specify ally position";
  const ally = getUnitAt(state, target);
  if (!ally || ally.side !== unit.side) return "No ally at target";
  if (distance(unit.position, ally.position) > 1) return "Must be adjacent";
  const usedHeals = unit.healsUsed || 0;
  if (usedHeals >= BALANCE.abilities.patch.maxUses)
    return `No heals remaining (max ${BALANCE.abilities.patch.maxUses} per game)`;
  const healed = Math.min(BALANCE.abilities.patch.healAmount, ally.maxHp - ally.hp);
  ally.hp += healed;
  unit.healsUsed = usedHeals + 1;
  state.log.push(
    `${unit.name} patches ${ally.name} (+${healed} HP) [${BALANCE.abilities.patch.maxUses - usedHeals - 1} heals left]`,
  );
  emit({
    type: "healing_done",
    sourceId: unit.id,
    targetId: ally.id,
    amount: healed,
    targetHpAfter: ally.hp,
    healsRemaining: BALANCE.abilities.patch.maxUses - usedHeals - 1,
  });
  return null;
}

function abilityOverclock(state: GameState, unit: Unit, target?: Position): string | null {
  if (unit.class !== "medic") return "Only Medic can use Overclock";
  if (!target) return "Must specify ally position";
  const ally = getUnitAt(state, target);
  if (!ally || ally.side !== unit.side) return "No ally at target";
  if (distance(unit.position, ally.position) > 1) return "Must be adjacent";
  ally.hp -= BALANCE.abilities.overclock.selfDamage;
  const effect = { type: "overclocked" as const };
  ally.statusEffects.push(effect);
  state.log.push(
    `${unit.name} overclocks ${ally.name} (-${BALANCE.abilities.overclock.selfDamage} HP, double ability next turn)`,
  );
  emit({
    type: "damage_dealt",
    sourceId: unit.id,
    targetId: ally.id,
    amount: BALANCE.abilities.overclock.selfDamage,
    ability: "overclock",
    targetHpAfter: ally.hp,
  });
  emit({ type: "status_applied", unitId: ally.id, effect, source: "overclock" });
  return null;
}

function abilityTrap(state: GameState, unit: Unit, target?: Position): string | null {
  if (unit.class !== "vector") return "Only Vector can use Trap";
  if (!target) return "Must specify position";
  if (distance(unit.position, target) > 2) return "Out of range (max 2)";
  if (!isValidPosition(target)) return "Invalid position";
  if (isOccupied(state, target)) return "Position occupied";
  state.traps.push({ position: target, owner: unit.id, side: unit.side });
  state.log.push(`${unit.name} places a trap`);
  emit({ type: "trap_placed", unitId: unit.id, position: { ...target } });
  return null;
}

function abilityPulse(state: GameState, unit: Unit): string | null {
  if (unit.class !== "vector") return "Only Vector can use Pulse";
  const affected = state.units.filter(
    (u) => u.hp > 0 && u.id !== unit.id && distance(u.position, unit.position) <= 1,
  );
  for (const target of affected) {
    const dmg = applyDamage(target, BALANCE.abilities.pulse.damage);
    state.log.push(`${unit.name}'s Pulse hits ${target.name} (-${dmg} HP)`);
    emit({
      type: "damage_dealt",
      sourceId: unit.id,
      targetId: target.id,
      amount: dmg,
      ability: "pulse",
      targetHpAfter: target.hp,
    });
    if (target.hp <= 0)
      emit({ type: "unit_killed", unitId: target.id, killerId: unit.id, ability: "pulse" });
  }
  return null;
}

// === Damage ===

function applyDamage(unit: Unit, amount: number): number {
  // Fortified = 50% damage reduction
  if (unit.statusEffects.some((e) => e.type === "fortified")) {
    amount = Math.ceil(amount / 2);
  }
  unit.hp = Math.max(0, unit.hp - amount);
  return amount;
}

// === Turn Management ===

export function startPlay(state: GameState): void {
  state.phase = "play";
  state.round = 1;
  state.turn = 1;
  state.log.push("=== Battle begins ===");

  // Build first round's turn stack
  state.turnStack = buildTurnStack(state);
  state.currentTurnStack = [...state.turnStack];

  emit({
    type: "game_start",
    grid: { ...state.grid },
    units: TrainingRecorder.snapshotUnits(state) as any,
    turnStack: [...state.turnStack],
  });
}

/** Clean up effects for a unit after it acts */
export function cleanupAfterUnitActs(state: GameState, unit: Unit): void {
  // Decrement cloak
  unit.statusEffects = unit.statusEffects.filter((e) => {
    if (e.type === "cloaked") {
      e.turnsLeft--;
      if (e.turnsLeft <= 0) {
        emit({ type: "status_removed", unitId: unit.id, effectType: "cloaked", reason: "expired" });
        return false;
      }
      return true;
    }
    // Remove temporary per-action effects
    if (e.type === "suppressed") {
      emit({
        type: "status_removed",
        unitId: unit.id,
        effectType: "suppressed",
        reason: "turn_end",
      });
      return false;
    }
    if (e.type === "shieldWall") {
      emit({
        type: "status_removed",
        unitId: unit.id,
        effectType: "shieldWall",
        reason: "turn_end",
      });
      return false;
    }
    if (e.type === "overclocked") {
      emit({
        type: "status_removed",
        unitId: unit.id,
        effectType: "overclocked",
        reason: "turn_end",
      });
      return false;
    }
    return true;
  });

  // Reset movement tracking
  unit.movedThisTurn = false;

  // Decay breach cooldown
  if (unit.breachCooldown != null && unit.breachCooldown > 0) {
    unit.breachCooldown--;
  }
  // Decay breach effect — restore original prompt when it fades
  if (unit.breachTurnsLeft != null && unit.breachTurnsLeft > 0) {
    unit.breachTurnsLeft--;
    if (unit.breachTurnsLeft <= 0) {
      if (unit.originalPrompt) {
        unit.prompt = unit.originalPrompt;
        unit.originalPrompt = undefined;
      }
      unit.breachTurnsLeft = undefined;
      state.log.push(`${unit.name} shakes off the breach!`);
    }
  }

  // Sentinel fortify: re-add if not present (will be removed when they move)
  if (unit.class === "sentinel" && unit.hp > 0) {
    if (!unit.statusEffects.some((e) => e.type === "fortified")) {
      const effect = { type: "fortified" as const };
      unit.statusEffects.push(effect);
      emit({ type: "status_applied", unitId: unit.id, effect, source: "passive" });
    }
  }
}

/** Check if the round is over and start a new one if needed. Returns true if game continues. */
export function advanceRound(state: GameState): boolean {
  // Emit turn end for current round
  emit({
    type: "turn_end",
    turn: state.round,
    side: "player", // legacy compat — not meaningful in per-unit system
    units: TrainingRecorder.snapshotUnits(state) as any,
    traps: TrainingRecorder.snapshotTraps(state),
  });

  // Check win
  const playerAlive = getLivingUnits(state, "player").length;
  const opponentAlive = getLivingUnits(state, "opponent").length;
  if (playerAlive === 0) {
    state.phase = "ended";
    state.winner = "opponent";
    state.log.push("=== Opponent wins ===");
    emit({
      type: "game_end",
      winner: "opponent",
      reason: "All player units eliminated",
      totalTurns: state.round,
      survivors: TrainingRecorder.snapshotUnits(state).filter((u: any) => u.hp > 0) as any,
    });
    return false;
  }
  if (opponentAlive === 0) {
    state.phase = "ended";
    state.winner = "player";
    state.log.push("=== Player wins ===");
    emit({
      type: "game_end",
      winner: "player",
      reason: "All opponent units eliminated",
      totalTurns: state.round,
      survivors: TrainingRecorder.snapshotUnits(state).filter((u: any) => u.hp > 0) as any,
    });
    return false;
  }

  // Start new round
  state.round++;
  state.turn = state.round;
  state.turnStack = buildTurnStack(state);
  state.currentTurnStack = [...state.turnStack];

  return true;
}

/** Check win condition mid-round (after a kill). Returns true if game should end. */
export function checkWinCondition(state: GameState): boolean {
  const playerAlive = getLivingUnits(state, "player").length;
  const opponentAlive = getLivingUnits(state, "opponent").length;

  if (playerAlive === 0) {
    state.phase = "ended";
    state.winner = "opponent";
    state.log.push("=== Opponent wins ===");
    emit({
      type: "game_end",
      winner: "opponent",
      reason: "All player units eliminated",
      totalTurns: state.round,
      survivors: TrainingRecorder.snapshotUnits(state).filter((u: any) => u.hp > 0) as any,
    });
    return true;
  }
  if (opponentAlive === 0) {
    state.phase = "ended";
    state.winner = "player";
    state.log.push("=== Player wins ===");
    emit({
      type: "game_end",
      winner: "player",
      reason: "All opponent units eliminated",
      totalTurns: state.round,
      survivors: TrainingRecorder.snapshotUnits(state).filter((u: any) => u.hp > 0) as any,
    });
    return true;
  }
  return false;
}
