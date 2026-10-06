import { test, expect } from "bun:test";
import { emit, setTrainingListener, withoutTrainingEvents, clearTrainingListener } from "./emitter";
test("dry-run events are suppressed and listener restored even on failure", () => {
  let count = 0;
  setTrainingListener(() => count++);
  expect(() =>
    withoutTrainingEvents(() => {
      emit({ type: "unit_killed", unitId: "x", killerId: "y", ability: "attack" });
      throw Error("probe");
    }),
  ).toThrow("probe");
  emit({ type: "unit_killed", unitId: "x", killerId: "y", ability: "attack" });
  expect(count).toBe(1);
  clearTrainingListener();
});
