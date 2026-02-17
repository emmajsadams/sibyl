import { describe, test, expect } from "bun:test";
import { generateRandomConfig } from "./squads";

describe("generateRandomConfig", () => {
  test("returns player and opponent sides", () => {
    const cfg = generateRandomConfig();
    expect(cfg.player).toBeDefined();
    expect(cfg.opponent).toBeDefined();
  });

  test("each side has 3 units", () => {
    const cfg = generateRandomConfig();
    expect(cfg.player.units).toHaveLength(3);
    expect(cfg.opponent.units).toHaveLength(3);
  });

  test("each unit has name, class, and prompt", () => {
    const cfg = generateRandomConfig();
    for (const side of [cfg.player, cfg.opponent]) {
      for (const unit of side.units) {
        expect(unit.name).toBeTruthy();
        expect(unit.class).toBeTruthy();
        expect(unit.prompt).toBeTruthy();
        expect(typeof unit.name).toBe("string");
        expect(typeof unit.prompt).toBe("string");
      }
    }
  });

  test("unit classes are valid", () => {
    const validClasses = ["sentinel", "specter", "oracle", "striker", "medic", "vector"];
    const cfg = generateRandomConfig();
    for (const side of [cfg.player, cfg.opponent]) {
      for (const unit of side.units) {
        expect(validClasses).toContain(unit.class);
      }
    }
  });

  test("each side has a placement prompt", () => {
    const cfg = generateRandomConfig();
    expect(cfg.player.placementPrompt).toBeTruthy();
    expect(cfg.opponent.placementPrompt).toBeTruthy();
  });

  test("generates different configs on multiple calls", () => {
    // Run multiple times - at least some should differ (probabilistic but very likely)
    const configs = Array.from({ length: 10 }, () => generateRandomConfig());
    const serialized = configs.map(c => JSON.stringify(c));
    const unique = new Set(serialized);
    expect(unique.size).toBeGreaterThan(1);
  });

  test("unit names within a side are unique", () => {
    // Run multiple times since it's random
    for (let i = 0; i < 20; i++) {
      const cfg = generateRandomConfig();
      for (const side of [cfg.player, cfg.opponent]) {
        const names = side.units.map(u => u.name);
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });
});
