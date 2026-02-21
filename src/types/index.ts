// === Balance Config (all tunable game parameters) ===
// Snapshotted into every training file for full reproducibility.

export interface BalanceConfig {
  version: string; // package.json version
  grid: { width: number; height: number };
  maxRounds: number;
  unitStats: Record<UnitClass, UnitStats>;
  abilities: {
    attack: { damage: number };
    shadowStrike: { damage: number };
    breach: { maxUses: number; cooldown: number; duration: number; range: number };
    cloak: { duration: number };
    precisionShot: { damage: number; movedDamage: number };
    scan: { damage: number };
    suppressingFire: { damage: number };
    patch: { maxUses: number; healAmount: number };
    overclock: { selfDamage: number };
    trap: { damage: number };
    pulse: { damage: number };
  };
}

// Current balance values — the single source of truth.
// Change these to tune the game; they'll be recorded with every match.

import { readFileSync } from "fs";
import { join } from "path";

const _pkg = JSON.parse(
  readFileSync(join(import.meta.dirname ?? ".", "../../package.json"), "utf-8"),
);

export const BALANCE: BalanceConfig = {
  version: _pkg.version,
  grid: { width: 6, height: 6 },
  maxRounds: 20,
  unitStats: {
    specter: { maxHp: 5, movement: 3, range: 1, speed: 3 },
    striker: { maxHp: 5, movement: 2, range: 2, speed: 2 },
    oracle: { maxHp: 6, movement: 3, range: 3, speed: 3 },
    medic: { maxHp: 11, movement: 2, range: 1, speed: 2 },
    vector: { maxHp: 7, movement: 2, range: 2, speed: 1 },
    sentinel: { maxHp: 11, movement: 2, range: 1, speed: 1 },
  },
  abilities: {
    attack: { damage: 1 },
    shadowStrike: { damage: 1 },
    breach: { maxUses: 2, cooldown: 2, duration: 3, range: 2 },
    cloak: { duration: 2 },
    precisionShot: { damage: 2, movedDamage: 1 },
    scan: { damage: 1 },
    suppressingFire: { damage: 1 },
    patch: { maxUses: 6, healAmount: 3 },
    overclock: { selfDamage: 1 },
    trap: { damage: 1 },
    pulse: { damage: 1 },
  },
};

// Legacy alias — code that imports UNIT_STATS still works
export const UNIT_STATS = BALANCE.unitStats;

// === Game Config (input to a game) ===

export interface UnitConfig {
  name: string;
  class: UnitClass;
  prompt: string;
}

export interface SideConfig {
  units: UnitConfig[];
  placementPrompt: string;
}

export interface GameConfig {
  player: SideConfig;
  opponent: SideConfig;
}

// === Core Types ===

export type Position = { x: number; y: number };
export type Direction = "N" | "S" | "E" | "W";
export type Side = "player" | "opponent";
export type UnitStatus = "healthy" | "wounded" | "critical" | "dead";

export type UnitClass = "sentinel" | "specter" | "oracle" | "striker" | "medic" | "vector";

export interface UnitStats {
  maxHp: number;
  movement: number;
  range: number;
  speed: number; // 1-3, determines turn order (higher = acts first)
}

// UNIT_STATS is now derived from BALANCE.unitStats (see top of file)

export interface Unit {
  id: string;
  name: string;
  class: UnitClass;
  side: Side;
  hp: number;
  maxHp: number;
  position: Position;
  movement: number;
  range: number;
  speed: number;
  facing: Direction;
  statusEffects: StatusEffect[];
  prompt: string;
  /** Original prompt saved before breach (restored when breach fades) */
  originalPrompt?: string;
  /** Turns remaining before breach fades */
  breachTurnsLeft?: number;
  /** Number of times this unit has used Breach (cap: 2) */
  breachesUsed?: number;
  /** Cooldown turns remaining before Breach can be used again */
  breachCooldown?: number;
  /** Whether this unit moved during current turn (for Striker penalty) */
  movedThisTurn?: boolean;
  /** Heal count used (Medic heal cap) */
  healsUsed?: number;
}

export type StatusEffect =
  | { type: "cloaked"; turnsLeft: number }
  | { type: "suppressed" } // movement reduced to 1
  | { type: "shieldWall"; direction: Direction }
  | { type: "overclocked" } // two abilities next turn
  | { type: "fortified" }; // didn't move, 50% damage reduction

export interface Trap {
  position: Position;
  owner: string; // unit id
  side: Side;
}

// === Actions ===

export type UnitAction =
  | { type: "move"; target: Position }
  | { type: "attack"; target: Position }
  | {
      type: "ability";
      ability: string;
      target?: Position;
      direction?: Direction;
      addendum?: string;
    }
  | { type: "wait" };

export interface TurnAction {
  unitId: string;
  first: UnitAction; // move or ability — either order
  second: UnitAction;
}

// === Game State ===

export interface GameState {
  grid: Grid;
  units: Unit[];
  traps: Trap[];
  /** Current round number (increments after all units act) */
  round: number;
  /** Legacy compat — same as round */
  turn: number;
  phase: "setup" | "play" | "ended";
  winner?: Side;
  log: string[];
  /** Tracks which enemies each Oracle has scanned: oracleId -> { enemyId -> last known prompt } */
  scanHistory: Record<string, Record<string, string>>;
  /** Full turn order for this round (unit IDs, highest speed first) */
  turnStack: string[];
  /** Remaining units yet to act this round */
  currentTurnStack: string[];
  /** ID of the unit currently acting */
  activeUnit?: string;
}

export interface Grid {
  width: number;
  height: number;
}

// === Agent Interface ===

export interface GameContext {
  unit: Unit;
  allies: UnitView[];
  enemies: UnitView[];
  traps: Position[]; // only own traps visible
  grid: Grid;
  turn: number;
  round: number;
  /** Full turn order for this round */
  turnOrder: {
    id: string;
    name: string;
    class: UnitClass;
    side: Side;
    speed: number;
    hasActed: boolean;
  }[];
  lastTurnActions?: string[]; // only for Oracle
  /** Enemies this Oracle has already scanned: enemyId -> last known prompt */
  scannedEnemies?: Record<string, string>;
}

/** What a unit can see about another unit */
export interface UnitView {
  id: string;
  name: string;
  class: UnitClass;
  position: Position;
  status: UnitStatus;
  hp?: number; // only visible to Medic for allies
  facing: Direction;
  cloaked: boolean;
  speed: number;
}

export interface AgentDecision {
  unitOrder: string[]; // unit ids in desired action order
  actions: Map<string, TurnAction>;
}

export interface PlacementDecision {
  placements: { unitId: string; position: Position }[];
}
