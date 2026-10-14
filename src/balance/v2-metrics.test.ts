import { expect, test } from "bun:test";
import { createGame, createUnit, startPlay, useAbility, checkWinCondition } from "../engine/game";
import { cleanupAfterUnitActs } from "../engine/game";
import { setTrainingListener, clearTrainingListener } from "../training/emitter";
test("paired quality tolerates intentional counters but diagnoses side advantage", () => {
  const c = new metrics.QualityCollector("fixture");
  const q = c.finish();
  const win = { ...q, winner: "player" as const };
  const loss = { ...q, winner: "opponent" as const };
  expect(scorePair([win, loss], defaultObjective()).imbalance).toBe(1);
  expect(scorePair([win, win], defaultObjective()).imbalance).toBe(0);
});
import { scorePair, defaultObjective } from "./v2-core";

import { summarizeQuality } from "./v2-metrics";
test("quality aggregate reports real composition coverage not matchup equality", () => {
  const c = new metrics.QualityCollector("summary-fixture");
  c.add({
    type: "engine_event",
    event: {
      type: "game_start",
      units: [
        { id: "p", class: "medic", side: "player" },
        { id: "o", class: "specter", side: "opponent" },
      ],
    },
  });
  c.add({
    type: "engine_event",
    event: {
      type: "game_end",
      winner: "player",
      totalTurns: 7,
      reason: "All opponent units eliminated",
    },
  });
  const summary = summarizeQuality([c.finish()]);
  expect(summary.games).toBe(1);
  expect(summary.duration.mean).toBe(7);
  expect(summary.compositions.medic!.wins).toBe(1);
  expect(summary.compositions.specter!.wins).toBe(0);
});
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { journalQuality } from "./v2-metrics";
test("journal replay preserves exact lines and hashes, rejects torn tails", async () => {
  const dir = mkdtempSync(join(tmpdir(), "v2-journal-fixture-")),
    path = join(dir, "events.jsonl");
  try {
    writeFileSync(
      path,
      JSON.stringify({
        type: "engine_event",
        event: {
          type: "game_end",
          totalTurns: 2,
          reason: "All opponent units eliminated",
          winner: "player",
        },
      }) + "\n",
    );
    const q = await journalQuality(path, "fixture-journal");
    expect(q.journalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(q.references[0]!.id).toBe("fixture-journal:L1");
    writeFileSync(path, "{broken");
    await expect(journalQuality(path, "fixture-journal")).rejects.toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
import { advanceRound } from "../engine/game";
test("real engine round-end events prevent late kills being labeled early and count survival", () => {
  const c = new metrics.QualityCollector("late-kill-fixture");
  setTrainingListener((event) => c.add({ type: "engine_event", event }));
  try {
    const s = createGame();
    const p = createUnit("p", "P", "sentinel", "player", { x: 0, y: 0 }, "wait"),
      o = createUnit("o", "O", "striker", "opponent", { x: 0, y: 1 }, "wait");
    s.units = [p, o];
    startPlay(s);
    for (let i = 0; i < 3; i++) advanceRound(s);
    useAbility(s, p, "attack", o.position);
    useAbility(s, p, "attack", o.position);
    checkWinCondition(s);
    const q = c.finish();
    expect(q.earlyEliminations).toBe(0);
    expect(q.classes.striker.survivalRounds).toBe(4);
  } finally {
    clearTrainingListener();
  }
});
test("zero healing is no direct impact and cleanup effects cannot leak into next provider action", () => {
  const c = new metrics.QualityCollector("no-effect-fixture");
  c.add({
    type: "engine_event",
    event: { type: "status_applied", unitId: "x", source: "passive" },
  });
  c.add({ type: "provider_start", round: 4 });
  c.add({
    type: "engine_event",
    event: { type: "healing_done", sourceId: "m", targetId: "x", amount: 0 },
  });
  c.add({
    type: "resolved_action",
    unit: "m",
    action: { type: "ability", ability: "patch" },
    error: null,
  });
  expect(c.finish().policy.zeroDirectImpactAbilities).toBe(1);
});
import { moveUnit } from "../engine/game";
test("real trap impact is attributed through actual placement and trigger events", () => {
  const c = new metrics.QualityCollector("trap-impact-fixture");
  setTrainingListener((event) => c.add({ type: "engine_event", event }));
  try {
    const s = createGame(),
      v = createUnit("v", "V", "vector", "player", { x: 0, y: 0 }, "trap"),
      e = createUnit("e", "E", "striker", "opponent", { x: 0, y: 2 }, "move");
    s.units = [v, e];
    startPlay(s);
    expect(useAbility(s, v, "trap", { x: 0, y: 1 })).toBeNull();
    expect(moveUnit(s, e, { x: 0, y: 1 })).toBeNull();
    expect(c.finish().classes.vector.damage).toBe(1);
    expect(c.finish().abilities.trap!.damage).toBe(1);
  } finally {
    clearTrainingListener();
  }
});
import * as metrics from "./v2-metrics";

test("real breach and recalibrate effects are observed without prompt disclosure", () => {
  const c = new metrics.QualityCollector("status-fixture-not-live");
  setTrainingListener((event) => c.add({ type: "engine_event", event }));
  try {
    const s = createGame();
    const spy = createUnit("s", "S", "specter", "player", { x: 0, y: 0 }, "private");
    const ally = createUnit("a", "A", "oracle", "opponent", { x: 0, y: 1 }, "private");
    ally.facing = "N";
    s.units = [spy, ally];
    startPlay(s);
    expect(useAbility(s, spy, "breach", ally.position, undefined, "Wait")).toBeNull();
    expect(useAbility(s, ally, "recalibrate", ally.position, undefined, "Wait")).toBeNull();
    expect(c.finish().abilities.breach!.breaches).toBe(1);
    expect(c.finish().abilities.recalibrate!.promptRewrites).toBe(1);
    expect(c.finish().classes.oracle.control).toBe(1);
    for (let i = 0; i < 3; i++) cleanupAfterUnitActs(s, ally);
    c.add({ type: "resolved_action", unit: ally.id, action: { type: "wait" }, error: null });
    expect(c.finish().policy.rewrittenPromptActions).toBe(0);
  } finally {
    clearTrainingListener();
  }
});

test("real engine events yield role damage healing kills survival and status evidence, never prompt text", () => {
  const collector = new metrics.QualityCollector("engine-fixture-not-live");
  setTrainingListener((event) => collector.add({ type: "engine_event", event }));
  try {
    const state = createGame();
    const medic = createUnit("m", "M", "medic", "player", { x: 0, y: 0 }, "PRIVATE PROMPT");
    const oracle = createUnit("o", "O", "oracle", "player", { x: 1, y: 0 }, "PRIVATE PROMPT");
    const enemy = createUnit("e", "E", "striker", "opponent", { x: 1, y: 1 }, "PRIVATE PROMPT");
    state.units = [medic, oracle, enemy];
    startPlay(state);
    medic.hp -= 1;
    expect(useAbility(state, medic, "patch", medic.position)).toBeNull();
    expect(useAbility(state, oracle, "scan", enemy.position)).toBeNull();
    checkWinCondition(state);
    const report = collector.finish();
    expect(report.classes.medic.healing).toBe(1);
    expect(report.classes.oracle.damage).toBe(2);
    expect(report.classes.oracle.kills).toBe(1);
    expect(report.classes.striker.survivors).toBe(0);
    expect(report.earlyEliminations).toBe(1);
    expect(report.rounds).toBe(1);
    expect(JSON.stringify(report)).not.toContain("PRIVATE PROMPT");
    expect(report.references.length).toBeGreaterThan(0);
  } finally {
    clearTrainingListener();
  }
});

test("observable policy diagnostics distinguish waits and no-direct-impact from certainty", () => {
  const c = new metrics.QualityCollector("diagnostic-fixture");
  c.add({ type: "engine_event", event: { type: "breach", attackerId: "s", targetId: "a" } });
  c.add({ type: "resolved_action", unit: "a", action: { type: "wait" }, error: null });
  c.add({
    type: "resolved_action",
    unit: "a",
    action: { type: "ability", ability: "shield_wall" },
    error: null,
  });
  c.add({ type: "match_failure", failure: "decision_error" });
  const q = c.finish();
  expect(q.policy.rewrittenPromptWaits).toBe(1);
  expect(q.policy.zeroDirectImpactAbilities).toBe(1);
  expect(q.policy.decisionErrors).toBe(1);
  expect(q.abilities.breach!.uses).toBe(0);
});
