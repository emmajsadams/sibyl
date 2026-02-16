import { z } from "zod/v4";

// === Primitives ===

const Position = z.object({ x: z.number(), y: z.number() });
const Side = z.enum(["player", "opponent"]);
const Direction = z.enum(["N", "S", "E", "W"]);
const UnitClass = z.enum(["sentinel", "specter", "oracle", "striker", "medic", "vector"]);
const UnitStatus = z.enum(["healthy", "wounded", "critical", "dead"]);

// === Unit Snapshot (full state of a unit at a point in time) ===

const StatusEffect = z.discriminatedUnion("type", [
  z.object({ type: z.literal("cloaked"), turnsLeft: z.number() }),
  z.object({ type: z.literal("suppressed") }),
  z.object({ type: z.literal("shieldWall"), direction: Direction }),
  z.object({ type: z.literal("overclocked") }),
  z.object({ type: z.literal("fortified") }),
]);

const UnitSnapshot = z.object({
  id: z.string(),
  name: z.string(),
  class: UnitClass,
  side: Side,
  hp: z.number(),
  maxHp: z.number(),
  position: Position,
  facing: Direction,
  statusEffects: z.array(StatusEffect),
  prompt: z.string(),
  breachAddendum: z.string().optional(),
  movedThisTurn: z.boolean().optional(),
  healsUsed: z.number().optional(),
});

// === Event Types ===

const GameStartEvent = z.object({
  type: z.literal("game_start"),
  grid: z.object({ width: z.number(), height: z.number() }),
  units: z.array(UnitSnapshot),
});

const TurnStartEvent = z.object({
  type: z.literal("turn_start"),
  turn: z.number(),
  side: Side,
  units: z.array(UnitSnapshot),
  traps: z.array(z.object({ position: Position, owner: z.string(), side: Side })),
});

const UnitPlacedEvent = z.object({
  type: z.literal("unit_placed"),
  unitId: z.string(),
  side: Side,
  class: UnitClass,
  position: Position,
});

const UnitMovedEvent = z.object({
  type: z.literal("unit_moved"),
  unitId: z.string(),
  from: Position,
  to: Position,
  newFacing: Direction,
  triggeredTrap: z.boolean(),
  trapDamage: z.number().optional(),
});

const AbilityUsedEvent = z.object({
  type: z.literal("ability_used"),
  unitId: z.string(),
  ability: z.string(),
  target: Position.optional(),
  direction: Direction.optional(),
  addendum: z.string().optional(),
  success: z.boolean(),
  error: z.string().optional(),
});

const DamageDealtEvent = z.object({
  type: z.literal("damage_dealt"),
  sourceId: z.string(),
  targetId: z.string(),
  amount: z.number(),
  ability: z.string(),
  targetHpAfter: z.number(),
});

const HealingDoneEvent = z.object({
  type: z.literal("healing_done"),
  sourceId: z.string(),
  targetId: z.string(),
  amount: z.number(),
  targetHpAfter: z.number(),
  healsRemaining: z.number(),
});

const StatusAppliedEvent = z.object({
  type: z.literal("status_applied"),
  unitId: z.string(),
  effect: StatusEffect,
  source: z.string(), // ability name or "passive"
});

const StatusRemovedEvent = z.object({
  type: z.literal("status_removed"),
  unitId: z.string(),
  effectType: z.string(),
  reason: z.string(), // "expired", "moved", "turn_end", "ability_break"
});

const UnitKilledEvent = z.object({
  type: z.literal("unit_killed"),
  unitId: z.string(),
  killerId: z.string(),
  ability: z.string(),
});

const TrapPlacedEvent = z.object({
  type: z.literal("trap_placed"),
  unitId: z.string(),
  position: Position,
});

const TrapTriggeredEvent = z.object({
  type: z.literal("trap_triggered"),
  unitId: z.string(),
  position: Position,
  damage: z.number(),
  unitHpAfter: z.number(),
});

const BreachEvent = z.object({
  type: z.literal("breach"),
  attackerId: z.string(),
  targetId: z.string(),
  oldPrompt: z.string(),
  newPrompt: z.string(),
});

const AgentDecisionEvent = z.object({
  type: z.literal("agent_decision"),
  unitId: z.string(),
  thinking: z.string(),
  firstAction: z.object({
    type: z.string(),
    ability: z.string().optional(),
    target: Position.optional(),
    direction: Direction.optional(),
  }),
  secondAction: z.object({
    type: z.string(),
    ability: z.string().optional(),
    target: Position.optional(),
    direction: Direction.optional(),
  }),
  durationMs: z.number(),
});

const DenialBlockedEvent = z.object({
  type: z.literal("denial_blocked"),
  unitId: z.string(),
  blockedAbility: z.string(),
  vectorId: z.string(),
});

const TurnEndEvent = z.object({
  type: z.literal("turn_end"),
  turn: z.number(),
  side: Side,
  units: z.array(UnitSnapshot),
  traps: z.array(z.object({ position: Position, owner: z.string(), side: Side })),
});

const GameEndEvent = z.object({
  type: z.literal("game_end"),
  winner: Side.optional(),
  reason: z.string(),
  totalTurns: z.number(),
  survivors: z.array(UnitSnapshot),
});

// === Union ===

export const TrainingEvent = z.discriminatedUnion("type", [
  GameStartEvent,
  TurnStartEvent,
  UnitPlacedEvent,
  UnitMovedEvent,
  AbilityUsedEvent,
  DamageDealtEvent,
  HealingDoneEvent,
  StatusAppliedEvent,
  StatusRemovedEvent,
  UnitKilledEvent,
  TrapPlacedEvent,
  TrapTriggeredEvent,
  BreachEvent,
  AgentDecisionEvent,
  DenialBlockedEvent,
  TurnEndEvent,
  GameEndEvent,
]);

export type TrainingEvent = z.infer<typeof TrainingEvent>;

// === Training Data File ===

export const TrainingFile = z.object({
  version: z.string(),
  gameId: z.string(),
  timestamp: z.string(),
  agent: z.string(),
  config: z.string().optional(),
  events: z.array(TrainingEvent),
});

export type TrainingFile = z.infer<typeof TrainingFile>;

// Re-export individual event types for convenience
export type GameStartEvent = z.infer<typeof GameStartEvent>;
export type TurnStartEvent = z.infer<typeof TurnStartEvent>;
export type UnitPlacedEvent = z.infer<typeof UnitPlacedEvent>;
export type UnitMovedEvent = z.infer<typeof UnitMovedEvent>;
export type AbilityUsedEvent = z.infer<typeof AbilityUsedEvent>;
export type DamageDealtEvent = z.infer<typeof DamageDealtEvent>;
export type HealingDoneEvent = z.infer<typeof HealingDoneEvent>;
export type StatusAppliedEvent = z.infer<typeof StatusAppliedEvent>;
export type StatusRemovedEvent = z.infer<typeof StatusRemovedEvent>;
export type UnitKilledEvent = z.infer<typeof UnitKilledEvent>;
export type TrapPlacedEvent = z.infer<typeof TrapPlacedEvent>;
export type TrapTriggeredEvent = z.infer<typeof TrapTriggeredEvent>;
export type BreachEvent = z.infer<typeof BreachEvent>;
export type AgentDecisionEvent = z.infer<typeof AgentDecisionEvent>;
export type DenialBlockedEvent = z.infer<typeof DenialBlockedEvent>;
export type TurnEndEvent = z.infer<typeof TurnEndEvent>;
export type GameEndEvent = z.infer<typeof GameEndEvent>;
