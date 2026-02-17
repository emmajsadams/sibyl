import { describe, test, expect } from "bun:test";
import {
  buildSystemPrompt,
  buildContextPrompt,
  buildPlayerPromptSection,
  buildPlacementPrompt,
} from "./prompts";
import { createUnit } from "../engine/game";
import type { GameContext, Unit, UnitView, UnitClass } from "../types";
import { UNIT_STATS } from "../types";

function makeUnit(cls: UnitClass, side: "player" | "opponent" = "player"): Unit {
  return createUnit("u1", "TestUnit", cls, side, { x: 2, y: 2 }, "Do stuff");
}

function makeView(
  id: string,
  cls: UnitClass,
  pos: { x: number; y: number },
  overrides: Partial<UnitView> = {},
): UnitView {
  return {
    id,
    name: id,
    class: cls,
    position: pos,
    status: "healthy",
    facing: "N",
    cloaked: false,
    speed: UNIT_STATS[cls].speed,
    ...overrides,
  };
}

function makeCtx(unit: Unit, overrides: Partial<GameContext> = {}): GameContext {
  return {
    unit,
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

describe("buildSystemPrompt", () => {
  const classes: UnitClass[] = ["sentinel", "specter", "oracle", "striker", "medic", "vector"];

  for (const cls of classes) {
    test(`includes class description for ${cls}`, () => {
      const u = makeUnit(cls);
      const prompt = buildSystemPrompt(u);
      expect(prompt).toContain(cls.toUpperCase());
      expect(prompt).toContain("6x6 grid");
      expect(prompt).toContain("JSON object");
    });
  }

  test("sentinel prompt mentions shield_wall and fortify", () => {
    const prompt = buildSystemPrompt(makeUnit("sentinel"));
    expect(prompt).toContain("shield_wall");
    expect(prompt).toContain("Fortify");
  });

  test("specter prompt mentions breach and cloak", () => {
    const prompt = buildSystemPrompt(makeUnit("specter"));
    expect(prompt).toContain("breach");
    expect(prompt).toContain("cloak");
  });

  test("oracle prompt mentions scan and recalibrate", () => {
    const prompt = buildSystemPrompt(makeUnit("oracle"));
    expect(prompt).toContain("scan");
    expect(prompt).toContain("recalibrate");
  });
});

describe("buildContextPrompt", () => {
  test("includes round, position, HP", () => {
    const u = makeUnit("sentinel");
    const ctx = makeCtx(u, { round: 3 });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("ROUND 3");
    expect(text).toContain("(2,2)");
    expect(text).toContain(`HP:${u.hp}/${u.maxHp}`);
  });

  test("shows allies", () => {
    const u = makeUnit("sentinel");
    const ally = makeView("ally1", "striker", { x: 3, y: 3 });
    const ctx = makeCtx(u, { allies: [ally] });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("ally1");
    expect(text).toContain("striker");
  });

  test("shows enemies", () => {
    const u = makeUnit("sentinel");
    const enemy = makeView("foe1", "specter", { x: 4, y: 4 });
    const ctx = makeCtx(u, { enemies: [enemy] });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("foe1");
    expect(text).toContain("specter");
  });

  test("shows no enemies message when empty", () => {
    const u = makeUnit("sentinel");
    const ctx = makeCtx(u, { enemies: [] });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("No enemies visible");
  });

  test("shows traps", () => {
    const u = makeUnit("vector");
    const ctx = makeCtx(u, { traps: [{ x: 1, y: 1 }] });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("(1,1)");
    expect(text).toContain("Traps");
  });

  // Medic heal tracking
  test("medic sees heals remaining", () => {
    const u = makeUnit("medic");
    u.healsUsed = 2;
    const ctx = makeCtx(u);
    const text = buildContextPrompt(ctx);
    expect(text).toContain("Heals remaining: 1/3");
  });

  test("medic sees heal exhausted warning", () => {
    const u = makeUnit("medic");
    u.healsUsed = 3;
    const ctx = makeCtx(u);
    const text = buildContextPrompt(ctx);
    expect(text).toContain("PATCH UNAVAILABLE");
  });

  test("medic sees ally HP and wound status", () => {
    const u = makeUnit("medic");
    const ally = makeView("ally1", "striker", { x: 3, y: 2 }, { hp: 2 });
    const ctx = makeCtx(u, { allies: [ally] });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("WOUNDED");
    expect(text).toContain("HP:2/");
  });

  test("medic sees FULL HP ally note", () => {
    const u = makeUnit("medic");
    const ally = makeView("ally1", "striker", { x: 3, y: 2 }, { hp: UNIT_STATS.striker.maxHp });
    const ctx = makeCtx(u, { allies: [ally] });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("FULL HP");
  });

  // Specter breach tracking
  test("specter sees breach count", () => {
    const u = makeUnit("specter");
    u.breachesUsed = 1;
    const ctx = makeCtx(u);
    const text = buildContextPrompt(ctx);
    expect(text).toContain("Breaches used: 1/2");
  });

  test("specter sees breach capped warning", () => {
    const u = makeUnit("specter");
    u.breachesUsed = 2;
    const ctx = makeCtx(u);
    const text = buildContextPrompt(ctx);
    expect(text).toContain("BREACH UNAVAILABLE");
  });

  test("specter sees breach cooldown", () => {
    const u = makeUnit("specter");
    u.breachesUsed = 1;
    u.breachCooldown = 2;
    const ctx = makeCtx(u);
    const text = buildContextPrompt(ctx);
    expect(text).toContain("cooldown: 2 turns");
  });

  test("specter round 1 cloak tip", () => {
    const u = makeUnit("specter");
    const ctx = makeCtx(u, { round: 1 });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("good time to cloak");
  });

  test("specter already cloaked tip", () => {
    const u = makeUnit("specter");
    u.statusEffects.push({ type: "cloaked", turnsLeft: 2 });
    const ctx = makeCtx(u, { round: 2 });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("Already cloaked");
    expect(text).toContain("Do NOT re-cloak");
  });

  // Denial warnings
  test("denial warning when adjacent to enemy vector", () => {
    const u = makeUnit("sentinel");
    const vec = makeView("vec1", "vector", { x: 2, y: 3 });
    const ctx = makeCtx(u, { enemies: [vec] });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("WARNING");
    expect(text).toContain("DENIAL");
  });

  test("denial caution when nearby vector", () => {
    const u = makeUnit("sentinel");
    const vec = makeView("vec1", "vector", { x: 2, y: 5 });
    const ctx = makeCtx(u, { enemies: [vec] });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("CAUTION");
  });

  // Oracle scan dedup
  test("oracle sees already-scanned enemies", () => {
    const u = makeUnit("oracle");
    const enemy = makeView("foe1", "specter", { x: 4, y: 4 });
    const ctx = makeCtx(u, {
      enemies: [enemy],
      scannedEnemies: { foe1: "some prompt" },
    });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("Already scanned");
    expect(text).toContain("some prompt");
  });

  test("oracle sees scan range info for unscanned enemies", () => {
    const u = makeUnit("oracle");
    const near = makeView("foe1", "striker", { x: 3, y: 3 });
    const far = makeView("foe2", "sentinel", { x: 5, y: 5 });
    const ctx = makeCtx(u, { enemies: [near, far], scannedEnemies: {} });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("in scan range");
    expect(text).toContain("OUT OF SCAN RANGE");
  });

  // Status effects
  test("shows overclocked status", () => {
    const u = makeUnit("striker");
    u.statusEffects.push({ type: "overclocked" });
    const ctx = makeCtx(u);
    const text = buildContextPrompt(ctx);
    expect(text).toContain("OVERCLOCKED");
  });

  test("shows fortified status", () => {
    const u = makeUnit("sentinel");
    u.statusEffects.push({ type: "fortified" });
    const ctx = makeCtx(u);
    const text = buildContextPrompt(ctx);
    expect(text).toContain("FORTIFIED");
  });

  test("shows suppressed status", () => {
    const u = makeUnit("striker");
    u.statusEffects.push({ type: "suppressed" });
    const ctx = makeCtx(u);
    const text = buildContextPrompt(ctx);
    expect(text).toContain("SUPPRESSED");
  });

  // Turn order
  test("shows turn order", () => {
    const u = makeUnit("sentinel");
    const ctx = makeCtx(u, {
      turnOrder: [
        {
          id: "u1",
          name: "TestUnit",
          class: "sentinel",
          side: "player",
          speed: 1,
          hasActed: false,
        },
        { id: "e1", name: "Foe", class: "specter", side: "opponent", speed: 3, hasActed: true },
      ],
    });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("Order:");
    expect(text).toContain("TestUnit");
    expect(text).toContain("Foe");
  });

  // Foresight (oracle only)
  test("oracle sees last turn actions", () => {
    const u = makeUnit("oracle");
    const ctx = makeCtx(u, { lastTurnActions: ["Enemy moved to (3,3)", "Enemy attacked ally"] });
    const text = buildContextPrompt(ctx);
    expect(text).toContain("Foresight");
    expect(text).toContain("Enemy moved to (3,3)");
  });
});

describe("buildPlayerPromptSection", () => {
  test("includes unit prompt", () => {
    const u = makeUnit("sentinel");
    u.prompt = "Hold the line";
    const text = buildPlayerPromptSection(u);
    expect(text).toContain("Hold the line");
    expect(text).toContain("Orders:");
  });
});

describe("buildPlacementPrompt", () => {
  test("player gets bottom rows", () => {
    const text = buildPlacementPrompt([{ name: "Tank", class: "sentinel" }], "player");
    expect(text).toContain("0-1");
    expect(text).toContain("Tank(sentinel)");
  });

  test("opponent gets top rows", () => {
    const text = buildPlacementPrompt([{ name: "Ghost", class: "specter" }], "opponent");
    expect(text).toContain("4-5");
  });
});
