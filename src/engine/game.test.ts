import { describe, test, expect } from "bun:test";
import {
  createUnit,
  createGame,
  isValidPosition,
  distance,
  placeUnit,
  moveUnit,
  isBehind,
  buildTurnStack,
  useAbility,
  checkWinCondition,
} from "./game";
import { UNIT_STATS } from "../types";
import type { Unit } from "../types";

// Helper: quick unit factory
function unit(
  id: string,
  cls: Unit["class"],
  side: Unit["side"],
  pos: { x: number; y: number },
): Unit {
  return createUnit(id, id, cls, side, pos, "test");
}

describe("createUnit", () => {
  test("creates sentinel with correct stats", () => {
    const u = createUnit("s1", "Tank", "sentinel", "player", { x: 0, y: 0 }, "p");
    const stats = UNIT_STATS.sentinel;
    expect(u.hp).toBe(stats.maxHp);
    expect(u.movement).toBe(stats.movement);
    expect(u.range).toBe(stats.range);
    expect(u.speed).toBe(stats.speed);
    expect(u.facing).toBe("N");
  });

  test("opponent units face south", () => {
    const u = createUnit("o1", "Foe", "striker", "opponent", { x: 0, y: 5 }, "p");
    expect(u.facing).toBe("S");
  });

  test("each class gets its own stats", () => {
    for (const cls of ["sentinel", "specter", "oracle", "striker", "medic", "vector"] as const) {
      const u = createUnit("x", "x", cls, "player", { x: 0, y: 0 }, "");
      expect(u.maxHp).toBe(UNIT_STATS[cls].maxHp);
      expect(u.speed).toBe(UNIT_STATS[cls].speed);
    }
  });
});

describe("createGame", () => {
  test("initializes empty game state", () => {
    const g = createGame();
    expect(g.units).toEqual([]);
    expect(g.phase).toBe("setup");
    expect(g.grid).toEqual({ width: 6, height: 6 });
    expect(g.round).toBe(0);
  });
});

describe("isValidPosition", () => {
  test("valid positions 0-5", () => {
    expect(isValidPosition({ x: 0, y: 0 })).toBe(true);
    expect(isValidPosition({ x: 5, y: 5 })).toBe(true);
    expect(isValidPosition({ x: 3, y: 2 })).toBe(true);
  });

  test("invalid positions", () => {
    expect(isValidPosition({ x: -1, y: 0 })).toBe(false);
    expect(isValidPosition({ x: 0, y: -1 })).toBe(false);
    expect(isValidPosition({ x: 6, y: 0 })).toBe(false);
    expect(isValidPosition({ x: 0, y: 6 })).toBe(false);
  });
});

describe("distance", () => {
  test("manhattan distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(7);
    expect(distance({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
    expect(distance({ x: 1, y: 0 }, { x: 0, y: 1 })).toBe(2);
  });
});

describe("placeUnit", () => {
  test("places player unit on valid row", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    const err = placeUnit(g, u, { x: 2, y: 0 });
    expect(err).toBeNull();
    expect(u.position).toEqual({ x: 2, y: 0 });
    expect(g.units).toContain(u);
  });

  test("rejects occupied tile", () => {
    const g = createGame();
    const u1 = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    const u2 = unit("p2", "striker", "player", { x: 0, y: 0 });
    placeUnit(g, u1, { x: 2, y: 0 });
    const err = placeUnit(g, u2, { x: 2, y: 0 });
    expect(err).toBe("Position occupied");
  });

  test("rejects wrong row for side", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    const err = placeUnit(g, u, { x: 0, y: 3 });
    expect(err).toBe("Invalid row for placement");
  });

  test("rejects out-of-bounds", () => {
    const g = createGame();
    const u = unit("o1", "sentinel", "opponent", { x: 0, y: 4 });
    const err = placeUnit(g, u, { x: 6, y: 4 });
    expect(err).toBe("Position out of bounds");
  });
});

describe("moveUnit", () => {
  test("valid move updates position", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 2, y: 2 });
    g.units.push(u);
    const err = moveUnit(g, u, { x: 3, y: 3 });
    expect(err).toBeNull();
    expect(u.position).toEqual({ x: 3, y: 3 });
  });

  test("rejects out-of-range move", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 0, y: 0 }); // movement=2
    g.units.push(u);
    const err = moveUnit(g, u, { x: 3, y: 0 });
    expect(err).toBe("Can only move 2 tiles");
  });

  test("rejects occupied tile", () => {
    const g = createGame();
    const u1 = unit("p1", "striker", "player", { x: 2, y: 2 });
    const u2 = unit("p2", "sentinel", "player", { x: 3, y: 2 });
    g.units.push(u1, u2);
    const err = moveUnit(g, u1, { x: 3, y: 2 });
    expect(err).toBe("Position occupied");
  });

  test("updates facing based on movement direction", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 2, y: 2 });
    g.units.push(u);
    moveUnit(g, u, { x: 4, y: 2 });
    expect(u.facing).toBe("E");
  });
});

describe("isBehind", () => {
  test("behind unit facing N means attacker south of target (dy < 0)", () => {
    const target = unit("t", "sentinel", "player", { x: 3, y: 3 });
    target.facing = "N";
    expect(isBehind({ x: 3, y: 2 }, target)).toBe(true);
    expect(isBehind({ x: 3, y: 4 }, target)).toBe(false);
  });

  test("behind unit facing S", () => {
    const target = unit("t", "sentinel", "opponent", { x: 3, y: 3 });
    target.facing = "S";
    expect(isBehind({ x: 3, y: 4 }, target)).toBe(true);
    expect(isBehind({ x: 3, y: 2 }, target)).toBe(false);
  });

  test("behind unit facing E", () => {
    const target = unit("t", "sentinel", "player", { x: 3, y: 3 });
    target.facing = "E";
    expect(isBehind({ x: 2, y: 3 }, target)).toBe(true);
    expect(isBehind({ x: 4, y: 3 }, target)).toBe(false);
  });

  test("behind unit facing W", () => {
    const target = unit("t", "sentinel", "player", { x: 3, y: 3 });
    target.facing = "W";
    expect(isBehind({ x: 4, y: 3 }, target)).toBe(true);
    expect(isBehind({ x: 2, y: 3 }, target)).toBe(false);
  });
});

describe("buildTurnStack", () => {
  test("orders by speed descending", () => {
    const g = createGame();
    const specter = unit("spec", "specter", "player", { x: 0, y: 0 }); // speed 3
    const striker = unit("str", "striker", "player", { x: 1, y: 0 }); // speed 2
    const sentinel = unit("sen", "sentinel", "player", { x: 2, y: 0 }); // speed 1
    g.units.push(specter, striker, sentinel);
    const stack = buildTurnStack(g);
    expect(stack.indexOf("spec")).toBeLessThan(stack.indexOf("str"));
    expect(stack.indexOf("str")).toBeLessThan(stack.indexOf("sen"));
  });
});

describe("useAbility - attack", () => {
  test("basic melee attack deals damage", () => {
    const g = createGame();
    const attacker = unit("a", "sentinel", "player", { x: 2, y: 2 });
    const target = unit("t", "sentinel", "opponent", { x: 2, y: 3 });
    g.units.push(attacker, target);
    const hpBefore = target.hp;
    const err = useAbility(g, attacker, "attack", { x: 2, y: 3 });
    expect(err).toBeNull();
    expect(target.hp).toBe(hpBefore - 1);
  });

  test("rejects non-adjacent target", () => {
    const g = createGame();
    const attacker = unit("a", "sentinel", "player", { x: 0, y: 0 });
    const target = unit("t", "sentinel", "opponent", { x: 3, y: 3 });
    g.units.push(attacker, target);
    const err = useAbility(g, attacker, "attack", { x: 3, y: 3 });
    expect(err).toBe("Must be adjacent");
  });
});

describe("checkWinCondition", () => {
  test("detects opponent win when all player units dead", () => {
    const g = createGame();
    const p = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    p.hp = 0;
    const o = unit("o1", "sentinel", "opponent", { x: 5, y: 5 });
    g.units.push(p, o);
    expect(checkWinCondition(g)).toBe(true);
    expect(g.winner).toBe("opponent");
  });

  test("detects player win when all opponent units dead", () => {
    const g = createGame();
    const p = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    const o = unit("o1", "sentinel", "opponent", { x: 5, y: 5 });
    o.hp = 0;
    g.units.push(p, o);
    expect(checkWinCondition(g)).toBe(true);
    expect(g.winner).toBe("player");
  });

  test("returns false when both sides alive", () => {
    const g = createGame();
    g.units.push(
      unit("p1", "sentinel", "player", { x: 0, y: 0 }),
      unit("o1", "sentinel", "opponent", { x: 5, y: 5 }),
    );
    expect(checkWinCondition(g)).toBe(false);
  });
});
