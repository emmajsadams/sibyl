import { describe, test, expect, afterEach } from "bun:test";
import { TrainingRecorder } from "./recorder";
import { TrainingFile } from "./schema";
import { createUnit, createGame } from "../engine/game";
import { readFileSync, existsSync, rmSync } from "fs";

// Clean up test artifacts
const TEST_FILES: string[] = [];

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("TrainingRecorder", () => {
  afterEach(() => {
    for (const f of TEST_FILES) {
      if (existsSync(f)) rmSync(f);
    }
    TEST_FILES.length = 0;
  });

  test("creates a valid training file on construction", () => {
    const config = {
      player: {
        units: [{ name: "Tank", class: "sentinel" as const, prompt: "hold" }],
        placementPrompt: "place",
      },
      opponent: {
        units: [{ name: "Ghost", class: "specter" as const, prompt: "sneak" }],
        placementPrompt: "place",
      },
    };
    const recorder = new TrainingRecorder("test-agent", config);
    TEST_FILES.push(recorder.path);

    expect(existsSync(recorder.path)).toBe(true);
    const data = readJson(recorder.path);
    expect(() => TrainingFile.parse(data)).not.toThrow();
    expect(data.agent).toBe("test-agent");
    expect(data.events).toEqual([]);
  });

  test("records events and flushes to disk", () => {
    const config = {
      player: {
        units: [{ name: "A", class: "sentinel" as const, prompt: "p" }],
        placementPrompt: "p",
      },
      opponent: {
        units: [{ name: "B", class: "specter" as const, prompt: "p" }],
        placementPrompt: "p",
      },
    };
    const recorder = new TrainingRecorder("test-agent", config);
    TEST_FILES.push(recorder.path);

    recorder.record({
      type: "unit_placed",
      unitId: "u1",
      side: "player",
      class: "sentinel",
      position: { x: 0, y: 0 },
    });

    const data = readJson(recorder.path);
    expect(data.events).toHaveLength(1);
    expect(data.events[0].type).toBe("unit_placed");
  });

  test("recorded file passes schema validation", () => {
    const config = {
      player: {
        units: [{ name: "A", class: "sentinel" as const, prompt: "p" }],
        placementPrompt: "p",
      },
      opponent: {
        units: [{ name: "B", class: "specter" as const, prompt: "p" }],
        placementPrompt: "p",
      },
    };
    const recorder = new TrainingRecorder("test-agent", config);
    TEST_FILES.push(recorder.path);

    recorder.record({
      type: "damage_dealt",
      sourceId: "u1",
      targetId: "u2",
      amount: 2,
      ability: "attack",
      targetHpAfter: 8,
    });

    const data = readJson(recorder.path);
    expect(() => TrainingFile.parse(data)).not.toThrow();
  });
});

describe("TrainingRecorder.snapshotUnits", () => {
  test("snapshots all units with correct fields", () => {
    const state = createGame();
    const u = createUnit("u1", "Tank", "sentinel", "player", { x: 1, y: 0 }, "test prompt");
    u.statusEffects.push({ type: "fortified" });
    state.units.push(u);

    const snap = TrainingRecorder.snapshotUnits(state);
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe("u1");
    expect(snap[0].hp).toBe(u.hp);
    expect(snap[0].position).toEqual({ x: 1, y: 0 });
    expect(snap[0].statusEffects).toHaveLength(1);
    expect(snap[0].prompt).toBe("test prompt");
  });
});

describe("TrainingRecorder.snapshotTraps", () => {
  test("snapshots traps", () => {
    const state = createGame();
    state.traps.push({ position: { x: 3, y: 3 }, owner: "v1", side: "player" });

    const snap = TrainingRecorder.snapshotTraps(state);
    expect(snap).toHaveLength(1);
    expect(snap[0]!.position).toEqual({ x: 3, y: 3 });
    expect(snap[0]!.owner).toBe("v1");
  });
});

describe("TrainingRecorder.snapshotUnit", () => {
  test("snapshots single unit", () => {
    const u = createUnit("u1", "Ghost", "specter", "opponent", { x: 4, y: 5 }, "sneak");
    u.healsUsed = 1;
    const snap = TrainingRecorder.snapshotUnit(u);
    expect(snap.id).toBe("u1");
    expect(snap.class).toBe("specter");
    expect(snap.healsUsed).toBe(1);
  });
});
