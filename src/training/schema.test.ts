import { describe, test, expect } from "bun:test";
import { TrainingEvent, TrainingFile } from "./schema";

describe("TrainingEvent schema", () => {
  test("accepts valid game_start event", () => {
    const event = {
      type: "game_start",
      grid: { width: 6, height: 6 },
      units: [{
        id: "u1", name: "Tank", class: "sentinel", side: "player",
        hp: 10, maxHp: 10, speed: 1, position: { x: 0, y: 0 },
        facing: "N", statusEffects: [], prompt: "test",
      }],
      turnStack: ["u1"],
    };
    expect(() => TrainingEvent.parse(event)).not.toThrow();
  });

  test("accepts valid damage_dealt event", () => {
    const event = {
      type: "damage_dealt",
      sourceId: "u1", targetId: "u2",
      amount: 2, ability: "attack", targetHpAfter: 3,
    };
    expect(() => TrainingEvent.parse(event)).not.toThrow();
  });

  test("accepts valid unit_moved event", () => {
    const event = {
      type: "unit_moved",
      unitId: "u1",
      from: { x: 0, y: 0 }, to: { x: 1, y: 0 },
      newFacing: "E", triggeredTrap: false,
    };
    expect(() => TrainingEvent.parse(event)).not.toThrow();
  });

  test("accepts valid breach event", () => {
    const event = {
      type: "breach",
      attackerId: "s1", targetId: "t1",
      oldPrompt: "old", newPrompt: "new",
    };
    expect(() => TrainingEvent.parse(event)).not.toThrow();
  });

  test("accepts valid denial_blocked event", () => {
    const event = {
      type: "denial_blocked",
      unitId: "u1", blockedAbility: "scan", vectorId: "v1",
    };
    expect(() => TrainingEvent.parse(event)).not.toThrow();
  });

  test("accepts valid game_end event", () => {
    const event = {
      type: "game_end",
      winner: "player",
      reason: "All opponent units eliminated",
      totalTurns: 5,
      survivors: [],
    };
    expect(() => TrainingEvent.parse(event)).not.toThrow();
  });

  test("accepts healing_done event", () => {
    const event = {
      type: "healing_done",
      sourceId: "m1", targetId: "a1",
      amount: 2, targetHpAfter: 8, healsRemaining: 2,
    };
    expect(() => TrainingEvent.parse(event)).not.toThrow();
  });

  test("accepts status_applied with cloaked effect", () => {
    const event = {
      type: "status_applied",
      unitId: "s1",
      effect: { type: "cloaked", turnsLeft: 3 },
      source: "cloak",
    };
    expect(() => TrainingEvent.parse(event)).not.toThrow();
  });

  test("accepts status_applied with fortified effect", () => {
    const event = {
      type: "status_applied",
      unitId: "s1",
      effect: { type: "fortified" },
      source: "passive",
    };
    expect(() => TrainingEvent.parse(event)).not.toThrow();
  });

  test("rejects unknown event type", () => {
    const event = { type: "unknown_event", data: "foo" };
    expect(() => TrainingEvent.parse(event)).toThrow();
  });

  test("rejects malformed damage_dealt (missing fields)", () => {
    const event = { type: "damage_dealt", sourceId: "u1" };
    expect(() => TrainingEvent.parse(event)).toThrow();
  });

  test("rejects invalid position type", () => {
    const event = {
      type: "unit_moved",
      unitId: "u1",
      from: { x: "bad", y: 0 }, to: { x: 1, y: 0 },
      newFacing: "E", triggeredTrap: false,
    };
    expect(() => TrainingEvent.parse(event)).toThrow();
  });

  test("rejects invalid side value", () => {
    const event = {
      type: "unit_placed",
      unitId: "u1", side: "neutral", class: "sentinel",
      position: { x: 0, y: 0 },
    };
    expect(() => TrainingEvent.parse(event)).toThrow();
  });

  test("rejects invalid class value", () => {
    const event = {
      type: "unit_placed",
      unitId: "u1", side: "player", class: "wizard",
      position: { x: 0, y: 0 },
    };
    expect(() => TrainingEvent.parse(event)).toThrow();
  });
});

describe("TrainingFile schema", () => {
  test("accepts valid training file", () => {
    const file = {
      configId: "v0.5.6-0",
      gameId: "v0.5.6-0",
      timestamp: new Date().toISOString(),
      agent: "test",
      events: [
        {
          type: "game_start",
          grid: { width: 6, height: 6 },
          units: [],
          turnStack: [],
        },
      ],
    };
    expect(() => TrainingFile.parse(file)).not.toThrow();
  });

  test("accepts empty events array", () => {
    const file = {
      configId: "test",
      gameId: "test",
      timestamp: "2024-01-01T00:00:00.000Z",
      agent: "test",
      events: [],
    };
    expect(() => TrainingFile.parse(file)).not.toThrow();
  });

  test("rejects missing required fields", () => {
    expect(() => TrainingFile.parse({ configId: "test" })).toThrow();
  });
});
