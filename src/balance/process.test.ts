import { test, expect } from "bun:test";
import { safeEnv } from "./process";
test("child environment allowlists process configuration not unrelated secrets", () => {
  process.env.SIBYL_TEST_SECRET = "fixture-only";
  try {
    expect(safeEnv().SIBYL_TEST_SECRET).toBeUndefined();
    expect(safeEnv().PATH).toBe(process.env.PATH);
  } finally {
    delete process.env.SIBYL_TEST_SECRET;
  }
});
