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
  getUnit,
  getLivingUnits,
  getUnitStatus,
  isOccupied,
  getUnitAt,
  getNextUnit,
  unitActed,
  buildGameContext,
  startPlay,
  cleanupAfterUnitActs,
  advanceRound,
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

// === Additional query tests ===

describe("getUnit", () => {
  test("finds unit by id", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    g.units.push(u);
    expect(getUnit(g, "p1")).toBe(u);
  });

  test("returns undefined for missing id", () => {
    const g = createGame();
    expect(getUnit(g, "nope")).toBeUndefined();
  });
});

describe("getLivingUnits", () => {
  test("excludes dead units", () => {
    const g = createGame();
    const alive = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    const dead = unit("p2", "striker", "player", { x: 1, y: 0 });
    dead.hp = 0;
    g.units.push(alive, dead);
    expect(getLivingUnits(g)).toHaveLength(1);
  });

  test("filters by side", () => {
    const g = createGame();
    g.units.push(
      unit("p1", "sentinel", "player", { x: 0, y: 0 }),
      unit("o1", "sentinel", "opponent", { x: 5, y: 5 }),
    );
    expect(getLivingUnits(g, "player")).toHaveLength(1);
    expect(getLivingUnits(g, "opponent")).toHaveLength(1);
  });
});

describe("getUnitStatus", () => {
  test("healthy above 60%", () => {
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 }); // 10hp
    expect(getUnitStatus(u)).toBe("healthy");
  });

  test("wounded between 25-60%", () => {
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    u.hp = 4; // 50%
    expect(getUnitStatus(u)).toBe("wounded");
  });

  test("critical at or below 25%", () => {
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    u.hp = 2; // 20%
    expect(getUnitStatus(u)).toBe("critical");
  });

  test("dead at 0", () => {
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    u.hp = 0;
    expect(getUnitStatus(u)).toBe("dead");
  });
});

describe("isOccupied", () => {
  test("returns true for occupied position", () => {
    const g = createGame();
    g.units.push(unit("p1", "sentinel", "player", { x: 2, y: 2 }));
    expect(isOccupied(g, { x: 2, y: 2 })).toBe(true);
  });

  test("ignores dead units", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 2, y: 2 });
    u.hp = 0;
    g.units.push(u);
    expect(isOccupied(g, { x: 2, y: 2 })).toBe(false);
  });
});

describe("getUnitAt", () => {
  test("finds living unit at position", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 2, y: 2 });
    g.units.push(u);
    expect(getUnitAt(g, { x: 2, y: 2 })).toBe(u);
  });

  test("returns undefined at empty position", () => {
    const g = createGame();
    expect(getUnitAt(g, { x: 2, y: 2 })).toBeUndefined();
  });
});

// === Movement edge cases ===

describe("moveUnit - edge cases", () => {
  test("triggers trap on enemy trap tile", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 2, y: 2 });
    g.units.push(u);
    g.traps.push({ position: { x: 3, y: 2 }, owner: "o1", side: "opponent" });
    const hpBefore = u.hp;
    moveUnit(g, u, { x: 3, y: 2 });
    expect(u.hp).toBe(hpBefore - 1);
    expect(g.traps).toHaveLength(0);
  });

  test("removes fortified on move", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 2, y: 2 });
    u.statusEffects.push({ type: "fortified" });
    g.units.push(u);
    moveUnit(g, u, { x: 3, y: 2 });
    expect(u.statusEffects.some((e) => e.type === "fortified")).toBe(false);
  });

  test("suppressed unit can only move 1 tile", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 2, y: 2 });
    u.statusEffects.push({ type: "suppressed" });
    g.units.push(u);
    const err = moveUnit(g, u, { x: 4, y: 2 });
    expect(err).toContain("Can only move 1");
  });

  test("out of bounds rejected", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 0, y: 0 });
    g.units.push(u);
    expect(moveUnit(g, u, { x: -1, y: 0 })).toBe("Out of bounds");
  });

  test("sets movedThisTurn", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 2, y: 2 });
    g.units.push(u);
    moveUnit(g, u, { x: 3, y: 2 });
    expect(u.movedThisTurn).toBe(true);
  });
});

// === Ability tests ===

describe("useAbility - cloak", () => {
  test("specter can cloak", () => {
    const g = createGame();
    const u = unit("s1", "specter", "player", { x: 2, y: 2 });
    g.units.push(u);
    const err = useAbility(g, u, "cloak");
    expect(err).toBeNull();
    expect(u.statusEffects.some((e) => e.type === "cloaked")).toBe(true);
  });

  test("non-specter cannot cloak", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 2, y: 2 });
    g.units.push(u);
    expect(useAbility(g, u, "cloak")).toBe("Only Specter can use Cloak");
  });
});

describe("useAbility - shadow_strike", () => {
  test("deals 1 damage to adjacent enemy", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 2 });
    const t = unit("o1", "sentinel", "opponent", { x: 2, y: 3 });
    g.units.push(s, t);
    const hpBefore = t.hp;
    const err = useAbility(g, s, "shadow_strike", { x: 2, y: 3 });
    expect(err).toBeNull();
    expect(t.hp).toBe(hpBefore - 1);
  });

  test("does not break cloak", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 2 });
    s.statusEffects.push({ type: "cloaked", turnsLeft: 3 });
    const t = unit("o1", "sentinel", "opponent", { x: 2, y: 3 });
    g.units.push(s, t);
    useAbility(g, s, "shadow_strike", { x: 2, y: 3 });
    expect(s.statusEffects.some((e) => e.type === "cloaked")).toBe(true);
  });

  test("rejects non-adjacent target", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 0, y: 0 });
    const t = unit("o1", "sentinel", "opponent", { x: 3, y: 3 });
    g.units.push(s, t);
    expect(useAbility(g, s, "shadow_strike", { x: 3, y: 3 })).toBe("Must be adjacent");
  });

  test("rejects ally target", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 2 });
    const a = unit("p2", "sentinel", "player", { x: 2, y: 3 });
    g.units.push(s, a);
    expect(useAbility(g, s, "shadow_strike", { x: 2, y: 3 })).toBe("No enemy at target");
  });
});

describe("useAbility - breach", () => {
  test("replaces enemy prompt when behind", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 2 });
    const t = unit("o1", "sentinel", "opponent", { x: 2, y: 4 });
    t.facing = "N"; // back is south, attacker at y=2 is south of y=4
    g.units.push(s, t);
    const err = useAbility(g, s, "breach", { x: 2, y: 4 }, undefined, "Do nothing");
    expect(err).toBeNull();
    expect(t.prompt).toBe("Do nothing");
    expect(t.originalPrompt).toBe("test");
    expect(t.breachTurnsLeft).toBe(3);
    expect(s.breachesUsed).toBe(1);
    expect(s.breachCooldown).toBe(2);
  });

  test("breach cap at 2", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 2 });
    s.breachesUsed = 2;
    const t = unit("o1", "sentinel", "opponent", { x: 2, y: 4 });
    t.facing = "N";
    g.units.push(s, t);
    expect(useAbility(g, s, "breach", { x: 2, y: 4 }, undefined, "hack")).toContain(
      "limit reached",
    );
  });

  test("breach cooldown blocks", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 2 });
    s.breachesUsed = 1;
    s.breachCooldown = 1;
    const t = unit("o1", "sentinel", "opponent", { x: 2, y: 4 });
    t.facing = "N";
    g.units.push(s, t);
    expect(useAbility(g, s, "breach", { x: 2, y: 4 }, undefined, "hack")).toContain("cooldown");
  });

  test("breach requires being behind", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 5 });
    const t = unit("o1", "sentinel", "opponent", { x: 2, y: 4 });
    t.facing = "N"; // back is south, attacker at y=5 is north
    g.units.push(s, t);
    expect(useAbility(g, s, "breach", { x: 2, y: 4 }, undefined, "hack")).toBe(
      "Must be behind the target",
    );
  });

  test("breach requires addendum", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 2 });
    const t = unit("o1", "sentinel", "opponent", { x: 2, y: 4 });
    t.facing = "N";
    g.units.push(s, t);
    expect(useAbility(g, s, "breach", { x: 2, y: 4 })).toBe(
      "Must provide addendum text for Breach",
    );
  });
});

describe("useAbility - scan", () => {
  test("oracle scans enemy prompt", () => {
    const g = createGame();
    const o = unit("o1", "oracle", "player", { x: 2, y: 2 });
    const t = unit("e1", "striker", "opponent", { x: 4, y: 2 });
    g.units.push(o, t);
    const err = useAbility(g, o, "scan", { x: 4, y: 2 });
    expect(err).toBeNull();
    expect(g.scanHistory["o1"]?.["e1"]).toContain("test");
  });

  test("scan out of range", () => {
    const g = createGame();
    const o = unit("o1", "oracle", "player", { x: 0, y: 0 });
    const t = unit("e1", "striker", "opponent", { x: 5, y: 5 });
    g.units.push(o, t);
    expect(useAbility(g, o, "scan", { x: 5, y: 5 })).toBe("Out of range (max 4)");
  });

  test("only oracle can scan", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 2, y: 2 });
    const t = unit("e1", "striker", "opponent", { x: 2, y: 3 });
    g.units.push(u, t);
    expect(useAbility(g, u, "scan", { x: 2, y: 3 })).toBe("Only Oracle can use Scan");
  });
});

describe("useAbility - recalibrate", () => {
  test("appends to ally prompt", () => {
    const g = createGame();
    const o = unit("o1", "oracle", "player", { x: 2, y: 2 });
    const a = unit("a1", "striker", "player", { x: 2, y: 3 });
    g.units.push(o, a);
    const err = useAbility(g, o, "recalibrate", { x: 2, y: 3 }, undefined, "Focus fire on medic");
    expect(err).toBeNull();
    expect(a.prompt).toContain("Focus fire on medic");
  });
});

describe("useAbility - precision_shot", () => {
  test("deals 2 damage at range when not moved", () => {
    const g = createGame();
    const s = unit("s1", "striker", "player", { x: 0, y: 0 });
    const t = unit("e1", "sentinel", "opponent", { x: 2, y: 0 });
    g.units.push(s, t);
    const hpBefore = t.hp;
    const err = useAbility(g, s, "precision_shot", { x: 2, y: 0 });
    expect(err).toBeNull();
    expect(t.hp).toBe(hpBefore - 2);
  });

  test("deals 1 damage when moved", () => {
    const g = createGame();
    const s = unit("s1", "striker", "player", { x: 0, y: 0 });
    s.movedThisTurn = true;
    const t = unit("e1", "sentinel", "opponent", { x: 2, y: 0 });
    g.units.push(s, t);
    const hpBefore = t.hp;
    useAbility(g, s, "precision_shot", { x: 2, y: 0 });
    expect(t.hp).toBe(hpBefore - 1);
  });

  test("high ground passive removed — range 3 is out of range", () => {
    const g = createGame();
    const s = unit("s1", "striker", "player", { x: 0, y: 0 }); // range 2
    const t = unit("e1", "sentinel", "opponent", { x: 3, y: 0 }); // dist 3, out of range 2
    g.units.push(s, t);
    expect(useAbility(g, s, "precision_shot", { x: 3, y: 0 })).toBe("Out of range");
  });

  test("cannot target cloaked unit", () => {
    const g = createGame();
    const s = unit("s1", "striker", "player", { x: 0, y: 0 });
    const t = unit("e1", "specter", "opponent", { x: 1, y: 0 });
    t.statusEffects.push({ type: "cloaked", turnsLeft: 2 });
    g.units.push(s, t);
    expect(useAbility(g, s, "precision_shot", { x: 1, y: 0 })).toBe("Cannot target cloaked unit");
  });
});

describe("useAbility - suppressing_fire", () => {
  test("damages and suppresses enemies in line", () => {
    const g = createGame();
    const s = unit("s1", "striker", "player", { x: 0, y: 0 });
    const t = unit("e1", "sentinel", "opponent", { x: 1, y: 0 });
    g.units.push(s, t);
    const hpBefore = t.hp;
    useAbility(g, s, "suppressing_fire", { x: 1, y: 0 });
    expect(t.hp).toBe(hpBefore - 1);
    expect(t.statusEffects.some((e) => e.type === "suppressed")).toBe(true);
  });
});

describe("useAbility - patch", () => {
  test("heals adjacent ally 6HP", () => {
    const g = createGame();
    const m = unit("m1", "medic", "player", { x: 2, y: 2 });
    const a = unit("a1", "sentinel", "player", { x: 2, y: 3 });
    a.hp = a.maxHp - 6;
    g.units.push(m, a);
    const hpBefore = a.hp;
    const err = useAbility(g, m, "patch", { x: 2, y: 3 });
    expect(err).toBeNull();
    expect(a.hp).toBe(hpBefore + 6);
    expect(m.healsUsed).toBe(1);
  });

  test("heal cap at 5", () => {
    const g = createGame();
    const m = unit("m1", "medic", "player", { x: 2, y: 2 });
    m.healsUsed = 12;
    const a = unit("a1", "sentinel", "player", { x: 2, y: 3 });
    a.hp = a.maxHp - 3;
    g.units.push(m, a);
    expect(useAbility(g, m, "patch", { x: 2, y: 3 })).toContain("No heals remaining");
  });

  test("must be adjacent", () => {
    const g = createGame();
    const m = unit("m1", "medic", "player", { x: 0, y: 0 });
    const a = unit("a1", "sentinel", "player", { x: 3, y: 3 });
    a.hp = a.maxHp - 3;
    g.units.push(m, a);
    expect(useAbility(g, m, "patch", { x: 3, y: 3 })).toBe("Must be adjacent");
  });
});

describe("useAbility - overclock", () => {
  test("applies overclocked with no self-damage", () => {
    const g = createGame();
    const m = unit("m1", "medic", "player", { x: 2, y: 2 });
    const a = unit("a1", "striker", "player", { x: 2, y: 3 });
    g.units.push(m, a);
    const hpBefore = a.hp;
    const err = useAbility(g, m, "overclock", { x: 2, y: 3 });
    expect(err).toBeNull();
    expect(a.hp).toBe(hpBefore);
    expect(a.statusEffects.some((e) => e.type === "overclocked")).toBe(true);
  });
});

describe("useAbility - trap", () => {
  test("places trap on empty tile", () => {
    const g = createGame();
    const v = unit("v1", "vector", "player", { x: 2, y: 2 });
    g.units.push(v);
    const err = useAbility(g, v, "trap", { x: 3, y: 3 });
    expect(err).toBeNull();
    expect(g.traps).toHaveLength(1);
    expect(g.traps[0]!.position).toEqual({ x: 3, y: 3 });
  });

  test("rejects occupied tile", () => {
    const g = createGame();
    const v = unit("v1", "vector", "player", { x: 2, y: 2 });
    const t = unit("p1", "sentinel", "player", { x: 3, y: 2 });
    g.units.push(v, t);
    expect(useAbility(g, v, "trap", { x: 3, y: 2 })).toBe("Position occupied");
  });

  test("rejects out of range", () => {
    const g = createGame();
    const v = unit("v1", "vector", "player", { x: 0, y: 0 });
    g.units.push(v);
    expect(useAbility(g, v, "trap", { x: 5, y: 5 })).toBe("Out of range (max 2)");
  });
});

describe("useAbility - pulse", () => {
  test("damages all adjacent units", () => {
    const g = createGame();
    const v = unit("v1", "vector", "player", { x: 2, y: 2 });
    const e1 = unit("e1", "striker", "opponent", { x: 2, y: 3 });
    const e2 = unit("e2", "striker", "opponent", { x: 3, y: 2 });
    const far = unit("e3", "striker", "opponent", { x: 5, y: 5 });
    g.units.push(v, e1, e2, far);
    const hp1 = e1.hp;
    const hp2 = e2.hp;
    const hp3 = far.hp;
    useAbility(g, v, "pulse");
    expect(e1.hp).toBe(hp1 - 1);
    expect(e2.hp).toBe(hp2 - 1);
    expect(far.hp).toBe(hp3); // not affected
  });
});

describe("useAbility - shield_wall", () => {
  test("applies shield wall effect", () => {
    const g = createGame();
    const s = unit("s1", "sentinel", "player", { x: 2, y: 2 });
    g.units.push(s);
    const err = useAbility(g, s, "shield_wall", undefined, "N");
    expect(err).toBeNull();
    expect(s.statusEffects.some((e) => e.type === "shieldWall")).toBe(true);
  });

  test("requires direction", () => {
    const g = createGame();
    const s = unit("s1", "sentinel", "player", { x: 2, y: 2 });
    g.units.push(s);
    expect(useAbility(g, s, "shield_wall")).toBe("Must specify direction");
  });
});

describe("useAbility - fortify damage reduction", () => {
  test("fortified unit takes half damage", () => {
    const g = createGame();
    const s = unit("s1", "sentinel", "player", { x: 2, y: 2 });
    s.statusEffects.push({ type: "fortified" });
    const a = unit("a1", "sentinel", "opponent", { x: 2, y: 3 });
    g.units.push(s, a);
    const hpBefore = s.hp;
    useAbility(g, a, "attack", { x: 2, y: 2 });
    // 1 damage -> ceil(1/2) = 1, so fortified doesn't help with 1 damage
    expect(s.hp).toBe(hpBefore - 1);
  });

  test("fortified reduces 2 damage to 1", () => {
    const g = createGame();
    const s = unit("s1", "sentinel", "player", { x: 2, y: 2 });
    s.statusEffects.push({ type: "fortified" });
    const a = unit("a1", "specter", "opponent", { x: 2, y: 3 });
    g.units.push(s, a);
    const hpBefore = s.hp;
    useAbility(g, a, "shadow_strike", { x: 2, y: 2 });
    // 2 damage -> ceil(2/2) = 1
    expect(s.hp).toBe(hpBefore - 1);
  });
});

// === Denial blocking ===

describe("useAbility - denial", () => {
  test("blocks ability when adjacent to enemy vector", () => {
    const g = createGame();
    const u = unit("p1", "specter", "player", { x: 2, y: 2 });
    const v = unit("v1", "vector", "opponent", { x: 2, y: 3 });
    g.units.push(u, v);
    const err = useAbility(g, u, "cloak");
    expect(err).toContain("Denial");
  });

  test("does not block basic attack", () => {
    const g = createGame();
    const u = unit("p1", "specter", "player", { x: 2, y: 2 });
    const v = unit("v1", "vector", "opponent", { x: 2, y: 3 });
    g.units.push(u, v);
    const err = useAbility(g, u, "attack", { x: 2, y: 3 });
    expect(err).toBeNull();
  });

  test("blocks scan when adjacent to enemy vector", () => {
    const g = createGame();
    const o = unit("o1", "oracle", "player", { x: 2, y: 2 });
    const v = unit("v1", "vector", "opponent", { x: 2, y: 3 });
    g.units.push(o, v);
    const err = useAbility(g, o, "scan", { x: 2, y: 3 });
    expect(err).toContain("Denial");
  });
});

// === Cloak break on ability use ===

describe("useAbility - cloak break", () => {
  test("using attack breaks cloak", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 2 });
    s.statusEffects.push({ type: "cloaked", turnsLeft: 3 });
    const t = unit("e1", "sentinel", "opponent", { x: 2, y: 3 });
    g.units.push(s, t);
    useAbility(g, s, "attack", { x: 2, y: 3 });
    expect(s.statusEffects.some((e) => e.type === "cloaked")).toBe(false);
  });

  test("using cloak itself does not break cloak", () => {
    const g = createGame();
    const s = unit("s1", "specter", "player", { x: 2, y: 2 });
    g.units.push(s);
    useAbility(g, s, "cloak");
    expect(s.statusEffects.some((e) => e.type === "cloaked")).toBe(true);
  });
});

// === Unknown ability ===

describe("useAbility - unknown", () => {
  test("returns error for unknown ability", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 2, y: 2 });
    g.units.push(u);
    expect(useAbility(g, u, "fireball")).toBe("Unknown ability: fireball");
  });
});

// === Turn management ===

describe("getNextUnit / unitActed", () => {
  test("gets next unit and advances", () => {
    const g = createGame();
    const u1 = unit("p1", "specter", "player", { x: 0, y: 0 });
    const u2 = unit("p2", "sentinel", "player", { x: 1, y: 0 });
    g.units.push(u1, u2);
    g.currentTurnStack = ["p1", "p2"];
    const next = getNextUnit(g);
    expect(next?.id).toBe("p1");
    unitActed(g);
    expect(g.currentTurnStack).toEqual(["p2"]);
  });

  test("skips dead units", () => {
    const g = createGame();
    const u1 = unit("p1", "specter", "player", { x: 0, y: 0 });
    u1.hp = 0;
    const u2 = unit("p2", "sentinel", "player", { x: 1, y: 0 });
    g.units.push(u1, u2);
    g.currentTurnStack = ["p1", "p2"];
    const next = getNextUnit(g);
    expect(next?.id).toBe("p2");
  });

  test("returns null when stack empty", () => {
    const g = createGame();
    g.currentTurnStack = [];
    expect(getNextUnit(g)).toBeNull();
  });
});

describe("cleanupAfterUnitActs", () => {
  test("decrements cloak turns", () => {
    const g = createGame();
    const u = unit("s1", "specter", "player", { x: 2, y: 2 });
    u.statusEffects.push({ type: "cloaked", turnsLeft: 2 });
    g.units.push(u);
    cleanupAfterUnitActs(g, u);
    const cloak = u.statusEffects.find((e) => e.type === "cloaked") as any;
    expect(cloak.turnsLeft).toBe(1);
  });

  test("removes expired cloak", () => {
    const g = createGame();
    const u = unit("s1", "specter", "player", { x: 2, y: 2 });
    u.statusEffects.push({ type: "cloaked", turnsLeft: 1 });
    g.units.push(u);
    cleanupAfterUnitActs(g, u);
    expect(u.statusEffects.some((e) => e.type === "cloaked")).toBe(false);
  });

  test("removes suppressed", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 2, y: 2 });
    u.statusEffects.push({ type: "suppressed" });
    g.units.push(u);
    cleanupAfterUnitActs(g, u);
    expect(u.statusEffects.some((e) => e.type === "suppressed")).toBe(false);
  });

  test("removes shieldWall", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 2, y: 2 });
    u.statusEffects.push({ type: "shieldWall", direction: "N" });
    g.units.push(u);
    cleanupAfterUnitActs(g, u);
    expect(u.statusEffects.some((e) => e.type === "shieldWall")).toBe(false);
  });

  test("removes overclocked", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 2, y: 2 });
    u.statusEffects.push({ type: "overclocked" });
    g.units.push(u);
    cleanupAfterUnitActs(g, u);
    expect(u.statusEffects.some((e) => e.type === "overclocked")).toBe(false);
  });

  test("resets movedThisTurn", () => {
    const g = createGame();
    const u = unit("p1", "striker", "player", { x: 2, y: 2 });
    u.movedThisTurn = true;
    g.units.push(u);
    cleanupAfterUnitActs(g, u);
    expect(u.movedThisTurn).toBe(false);
  });

  test("decays breach cooldown", () => {
    const g = createGame();
    const u = unit("s1", "specter", "player", { x: 2, y: 2 });
    u.breachCooldown = 2;
    g.units.push(u);
    cleanupAfterUnitActs(g, u);
    expect(u.breachCooldown).toBe(1);
  });

  test("restores prompt when breach fades", () => {
    const g = createGame();
    const u = unit("t1", "sentinel", "opponent", { x: 2, y: 2 });
    u.originalPrompt = "original orders";
    u.prompt = "breached orders";
    u.breachTurnsLeft = 1;
    g.units.push(u);
    cleanupAfterUnitActs(g, u);
    expect(u.prompt).toBe("original orders");
    expect(u.originalPrompt).toBeUndefined();
    expect(u.breachTurnsLeft).toBeUndefined();
  });

  test("sentinel gets fortified after acting", () => {
    const g = createGame();
    const u = unit("s1", "sentinel", "player", { x: 2, y: 2 });
    g.units.push(u);
    cleanupAfterUnitActs(g, u);
    expect(u.statusEffects.some((e) => e.type === "fortified")).toBe(true);
  });
});

describe("startPlay", () => {
  test("sets phase to play and round to 1", () => {
    const g = createGame();
    g.units.push(
      unit("p1", "sentinel", "player", { x: 0, y: 0 }),
      unit("o1", "sentinel", "opponent", { x: 5, y: 5 }),
    );
    startPlay(g);
    expect(g.phase).toBe("play");
    expect(g.round).toBe(1);
    expect(g.turnStack.length).toBeGreaterThan(0);
    expect(g.currentTurnStack).toEqual(g.turnStack);
  });
});

describe("advanceRound", () => {
  test("starts new round when both sides alive", () => {
    const g = createGame();
    g.round = 1;
    g.units.push(
      unit("p1", "sentinel", "player", { x: 0, y: 0 }),
      unit("o1", "sentinel", "opponent", { x: 5, y: 5 }),
    );
    const continues = advanceRound(g);
    expect(continues).toBe(true);
    expect(g.round).toBe(2);
  });

  test("ends game when all player units dead", () => {
    const g = createGame();
    g.round = 1;
    const p = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    p.hp = 0;
    g.units.push(p, unit("o1", "sentinel", "opponent", { x: 5, y: 5 }));
    const continues = advanceRound(g);
    expect(continues).toBe(false);
    expect(g.winner).toBe("opponent");
  });
});

describe("buildGameContext", () => {
  test("hides cloaked enemies", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    const e = unit("e1", "specter", "opponent", { x: 3, y: 3 });
    e.statusEffects.push({ type: "cloaked", turnsLeft: 2 });
    g.units.push(u, e);
    const ctx = buildGameContext(g, u);
    expect(ctx.enemies).toHaveLength(0);
  });

  test("includes own traps only", () => {
    const g = createGame();
    const u = unit("p1", "vector", "player", { x: 0, y: 0 });
    g.units.push(u);
    g.traps.push(
      { position: { x: 1, y: 1 }, owner: "p1", side: "player" },
      { position: { x: 4, y: 4 }, owner: "o1", side: "opponent" },
    );
    const ctx = buildGameContext(g, u);
    expect(ctx.traps).toHaveLength(1);
    expect(ctx.traps[0]).toEqual({ x: 1, y: 1 });
  });

  test("oracle gets lastTurnActions and scannedEnemies", () => {
    const g = createGame();
    const u = unit("o1", "oracle", "player", { x: 0, y: 0 });
    g.units.push(u);
    g.scanHistory["o1"] = { e1: "some prompt" };
    const ctx = buildGameContext(g, u, ["Enemy moved"]);
    expect(ctx.lastTurnActions).toEqual(["Enemy moved"]);
    expect(ctx.scannedEnemies).toEqual({ e1: "some prompt" });
  });

  test("non-oracle does not get lastTurnActions", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    g.units.push(u);
    const ctx = buildGameContext(g, u, ["Enemy moved"]);
    expect(ctx.lastTurnActions).toBeUndefined();
  });

  test("medic sees ally HP", () => {
    const g = createGame();
    const m = unit("m1", "medic", "player", { x: 0, y: 0 });
    const a = unit("a1", "striker", "player", { x: 1, y: 0 });
    a.hp = 2;
    g.units.push(m, a);
    const ctx = buildGameContext(g, m);
    expect(ctx.allies[0]!.hp).toBe(2);
  });

  test("non-medic does not see ally HP", () => {
    const g = createGame();
    const u = unit("p1", "sentinel", "player", { x: 0, y: 0 });
    const a = unit("a1", "striker", "player", { x: 1, y: 0 });
    g.units.push(u, a);
    const ctx = buildGameContext(g, u);
    expect(ctx.allies[0]!.hp).toBeUndefined();
  });
});
