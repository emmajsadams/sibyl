import { describe, test, expect } from "bun:test";
import { executeTool } from "./tools";
import type { GameContext, Unit, UnitView } from "../types";
import { createUnit } from "../engine/game";

// Helper to build a minimal GameContext
function makeCtx(overrides: Partial<GameContext> & { unit: Unit }): GameContext {
  return {
    allies: [],
    enemies: [],
    traps: [],
    grid: { width: 6, height: 6 },
    turn: 1,
    round: 1,
    turnOrder: [],
    ...overrides,
  };
}

function view(u: Unit): UnitView {
  return {
    id: u.id,
    name: u.name,
    class: u.class,
    position: u.position,
    status: "healthy",
    facing: u.facing,
    cloaked: false,
    speed: u.speed,
  };
}

describe("check_range", () => {
  test("returns distance and inRange", () => {
    const u = createUnit("p1", "Tank", "striker", "player", { x: 1, y: 1 }, ""); // range 3
    const ctx = makeCtx({ unit: u });
    const res = JSON.parse(executeTool(ctx, "check_range", { target_x: 3, target_y: 1 }).output);
    expect(res.dist).toBe(2);
    expect(res.inRange).toBe(true);
  });

  test("out of range", () => {
    const u = createUnit("p1", "Tank", "sentinel", "player", { x: 0, y: 0 }, ""); // range 1
    const ctx = makeCtx({ unit: u });
    const res = JSON.parse(executeTool(ctx, "check_range", { target_x: 5, target_y: 5 }).output);
    expect(res.dist).toBe(10);
    expect(res.inRange).toBe(false);
  });
});

describe("get_valid_moves", () => {
  test("respects movement range and grid bounds", () => {
    const u = createUnit("p1", "X", "sentinel", "player", { x: 0, y: 0 }, ""); // movement 2
    const ctx = makeCtx({ unit: u });
    const res = JSON.parse(executeTool(ctx, "get_valid_moves", {}).output);
    expect(res.mv).toBe(2);
    // All tiles should be within movement range and in bounds
    for (const [tx, ty] of res.tiles) {
      expect(tx).toBeGreaterThanOrEqual(0);
      expect(ty).toBeGreaterThanOrEqual(0);
      expect(tx).toBeLessThan(6);
      expect(ty).toBeLessThan(6);
      expect(Math.abs(tx - 0) + Math.abs(ty - 0)).toBeLessThanOrEqual(2);
    }
  });

  test("excludes occupied tiles", () => {
    const u = createUnit("p1", "X", "sentinel", "player", { x: 2, y: 2 }, "");
    const ally = createUnit("a1", "A", "striker", "player", { x: 3, y: 2 }, "");
    const ctx = makeCtx({ unit: u, allies: [view(ally)] });
    const res = JSON.parse(executeTool(ctx, "get_valid_moves", {}).output);
    const hasOccupied = res.tiles.some(
      ([tx, ty]: number[]) => tx === 3 && ty === 2,
    );
    expect(hasOccupied).toBe(false);
  });
});

describe("get_enemies_in_range", () => {
  test("filters by range", () => {
    const u = createUnit("p1", "X", "sentinel", "player", { x: 2, y: 2 }, ""); // range 1
    const near = createUnit("e1", "E1", "striker", "opponent", { x: 2, y: 3 }, "");
    const far = createUnit("e2", "E2", "striker", "opponent", { x: 5, y: 5 }, "");
    const ctx = makeCtx({ unit: u, enemies: [view(near), view(far)] });
    const res = JSON.parse(executeTool(ctx, "get_enemies_in_range", {}).output);
    expect(res.inRange).toHaveLength(1);
    expect(res.inRange[0].name).toBe("E1");
    expect(res.outRange).toHaveLength(1);
  });
});

describe("simulate_move", () => {
  test("rejects unreachable position", () => {
    const u = createUnit("p1", "X", "sentinel", "player", { x: 0, y: 0 }, ""); // movement 2
    const ctx = makeCtx({ unit: u });
    const res = JSON.parse(executeTool(ctx, "simulate_move", { target_x: 5, target_y: 5 }).output);
    expect(res.error).toContain("Unreachable");
  });

  test("shows enemies from new position", () => {
    const u = createUnit("p1", "X", "sentinel", "player", { x: 0, y: 0 }, ""); // range 1
    const enemy = createUnit("e1", "E", "striker", "opponent", { x: 2, y: 0 }, "");
    const ctx = makeCtx({ unit: u, enemies: [view(enemy)] });
    const res = JSON.parse(executeTool(ctx, "simulate_move", { target_x: 1, target_y: 0 }).output);
    expect(res.enemies).toHaveLength(1);
    expect(res.enemies[0].name).toBe("E");
  });
});
