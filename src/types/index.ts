// === Core Types ===

export type Position = { x: number; y: number };
export type Direction = "N" | "S" | "E" | "W";
export type Side = "player" | "opponent";
export type UnitStatus = "healthy" | "wounded" | "critical" | "dead";

export type UnitClass =
  | "sentinel"
  | "specter"
  | "oracle"
  | "striker"
  | "medic"
  | "vector";

export interface UnitStats {
  maxHp: number;
  movement: number;
  range: number;
}

export const UNIT_STATS: Record<UnitClass, UnitStats> = {
  sentinel: { maxHp: 10, movement: 2, range: 1 },
  specter: { maxHp: 5, movement: 3, range: 1 },
  oracle: { maxHp: 6, movement: 2, range: 4 },
  striker: { maxHp: 5, movement: 2, range: 3 },
  medic: { maxHp: 6, movement: 2, range: 1 },
  vector: { maxHp: 6, movement: 2, range: 2 },
};

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
  facing: Direction;
  statusEffects: StatusEffect[];
  prompt: string;
  /** Temporary prompt addendum injected by Breach */
  breachAddendum?: string;
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
  | { type: "ability"; ability: string; target?: Position; direction?: Direction; addendum?: string }
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
  turn: number;
  phase: "setup" | "play" | "ended";
  activesSide: Side;
  winner?: Side;
  log: string[];
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
  lastTurnActions?: string[]; // only for Oracle
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
}

export interface AgentDecision {
  unitOrder: string[]; // unit ids in desired action order
  actions: Map<string, TurnAction>;
}

export interface PlacementDecision {
  placements: { unitId: string; position: Position }[];
}
