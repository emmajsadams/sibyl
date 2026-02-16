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

export const UNIT_STATS: Record<UnitClass, UnitStats> = {
  // Specter: fastest — assassin strikes first, breach lands before target acts
  specter: { maxHp: 5, movement: 3, range: 1, speed: 3 },
  // Striker: mid-speed sniper — reduced HP to create counterplay opportunities
  striker: { maxHp: 4, movement: 2, range: 3, speed: 2 },
  // Oracle: buffed HP so it doesn't melt to 2 precision shots
  oracle: { maxHp: 8, movement: 2, range: 4, speed: 2 },
  // Medic: mid-speed — heals after initial damage lands
  medic: { maxHp: 6, movement: 2, range: 1, speed: 2 },
  // Vector: slow — places traps AFTER seeing where everyone moved
  vector: { maxHp: 6, movement: 2, range: 2, speed: 1 },
  // Sentinel: slowest — positions last, reactive tank
  sentinel: { maxHp: 10, movement: 2, range: 1, speed: 1 },
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
  speed: number;
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
