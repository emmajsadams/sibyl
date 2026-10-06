import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BALANCE } from "../types";
import { createGame, createUnit, advanceRound, checkWinCondition } from "../engine/game";
import {
  atomicJSON,
  candidateBalance,
  counts,
  evaluate,
  guard,
  hash,
  isClean,
  parseResult,
  LIMITS,
  settle,
  swapped,
  WHITELIST,
} from "./core";
import type { Checkpoint, Proposal, Result } from "./core";
import { generateRandomConfig } from "../training/squads";

function terminal(): Result {
  const state = createGame();
  state.units = [
    createUnit("p", "p", "sentinel", "player", { x: 0, y: 0 }, "wait"),
    createUnit("o", "o", "sentinel", "opponent", { x: 5, y: 5 }, "wait"),
  ];
  state.round = 20;
  advanceRound(state);
  return {
    clean: true,
    winner: state.winner ?? "draw",
    reason: state.terminalReason!,
    rounds: state.round,
    decisions: 2,
    failedDecisions: 0,
    failure: null,
    codeCommit: "fixture-only",
    requestHash: "fixture-only",
  };
}
function checkpoint(): Checkpoint {
  return {
    version: 1,
    startedAt: Date.now(),
    cycle: 1,
    attempts: [],
    manifestHashes: {},
    pending: null,
    consecutiveFailures: 0,
    halted: null,
    complete: false,
  };
}
const proposal = (path: string, value: number): Proposal => ({
  decision: "propose",
  path,
  value,
  reason: "class_imbalance",
});
test("clean gate requires real terminal evidence and no failed decisions", () => {
  const r = terminal();
  expect(isClean(r)).toBe(true);
  for (const patch of [
    { failedDecisions: 1 },
    { failure: "decision_error" },
    { decisions: 1001 },
    { reason: null },
    { winner: null },
    { clean: false },
  ])
    expect(isClean({ ...r, ...patch } as Result)).toBe(false);
});
test("engine HP tiebreak winner and elimination reasons retained", () => {
  const s = createGame();
  s.units = [
    createUnit("p", "p", "sentinel", "player", { x: 0, y: 0 }, "wait"),
    createUnit("o", "o", "striker", "opponent", { x: 5, y: 5 }, "wait"),
  ];
  s.round = 20;
  advanceRound(s);
  expect(s.winner).toBe("player");
  expect(s.terminalReason).toContain("wins by HP");
  s.units[0]!.hp = 0;
  checkWinCondition(s);
  expect(s.terminalReason).toBe("All player units eliminated");
});
test("side swaps preserve frozen generated squads and prompts verbatim", () => {
  const c = generateRandomConfig(),
    before = hash(c);
  const swap = swapped(c);
  expect(swap.player).toEqual(c.opponent);
  expect(swapped(swap)).toEqual(c);
  swap.player.units[0]!.prompt = "test mutation";
  expect(hash(c)).toBe(before);
});
test("numeric whitelist permits one bounded stat and rejects arbitrary code/mechanics", () => {
  const base = structuredClone(BALANCE);
  const p = proposal("unitStats.sentinel.maxHp", 5);
  const next = candidateBalance(base, p);
  expect(next.unitStats.sentinel.maxHp).toBe(5);
  expect(base).toEqual(BALANCE);
  for (const bad of [
    proposal("abilities.scan.damage", 1),
    proposal("__proto__.x.y", 1),
    proposal(p.path!, 20),
    proposal(p.path!, 5.1),
    proposal(p.path!, NaN),
    { ...p, code: "rm" },
  ])
    expect(() => candidateBalance(base, bad)).toThrow();
  expect(Object.keys(WHITELIST)).toHaveLength(24);
  expect(() => candidateBalance(base, { ...p, decision: "hold" })).toThrow();
});
test("checkpoints settle once, count discovery/evaluation separately, no dirty clean credit", () => {
  const s = checkpoint();
  const a = { id: 1, cycle: 1, stage: "discovery" as const, slot: 0, retry: 0 };
  s.pending = a;
  s.attempts.push(a);
  settle(s, terminal());
  expect(() => settle(s, terminal())).toThrow();
  const b = { id: 2, cycle: 1, stage: "evaluation" as const, slot: 0, retry: 0 };
  s.pending = b;
  s.attempts.push(b);
  settle(s, { ...terminal(), clean: false, failure: "http_502", failedDecisions: 1 });
  expect(counts(s)).toEqual({ attempts: 2, discovery: 1, evaluation: 0, failed: 1 });
  expect(s.halted).toBeNull();
});
test("timeouts retry the whole game at most twice without clean credit", () => {
  const s = checkpoint();
  for (let retry = 0; retry < 3; retry++) {
    const a = { id: retry + 1, cycle: 1, stage: "discovery" as const, slot: 0, retry };
    s.pending = a;
    s.attempts.push(a);
    settle(s, { ...terminal(), clean: false, failure: "timeout" });
    expect(counts(s).discovery).toBe(0);
    if (retry < 2) expect(s.halted).toBeNull();
  }
  expect(() => guard(s)).toThrow("Three consecutive");
});
test("finite match budget supports 188 sequential ten-second decisions", () => {
  expect(LIMITS.matchMs).toBeGreaterThanOrEqual(188 * 10000 + 120000);
  expect(LIMITS.matchMs).toBeLessThanOrEqual(60 * 60 * 1000);
});
test("502 retries are whole attempts, max two; third consecutive failure halts", () => {
  const s = checkpoint();
  for (let i = 0; i < 3; i++) {
    const a = { id: i + 1, cycle: 1, stage: "discovery" as const, slot: 0, retry: i };
    s.pending = a;
    s.attempts.push(a);
    settle(s, { ...terminal(), clean: false, failure: "http_502", failedDecisions: 1 });
  }
  expect(counts(s).discovery).toBe(0);
  expect(() => guard(s)).toThrow("Three consecutive");
});
test("any non-502 decision failure halts instead of silently filling clean quota", () => {
  const s = checkpoint(),
    a = { id: 1, cycle: 1, stage: "discovery" as const, slot: 0, retry: 0 };
  s.pending = a;
  s.attempts.push(a);
  settle(s, { ...terminal(), clean: false, failure: "decision_error", failedDecisions: 1 });
  expect(() => guard(s)).toThrow();
});
test("wall clock and global attempt caps survive resume", () => {
  const s = checkpoint();
  expect(() => guard(s, s.startedAt + LIMITS.wallMs)).toThrow("12-hour");
  s.attempts = Array.from({ length: 800 }, (_, i) => ({
    id: i + 1,
    cycle: 1,
    stage: "discovery",
    slot: i,
    retry: 0,
  }));
  expect(() => guard(s)).toThrow("800-attempt");
});
test("atomic checkpoint replacement retains pending attempts without temporary files", () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-checkpoint-test-"));
  try {
    const file = join(dir, "state.json"),
      s = checkpoint();
    atomicJSON(file, s);
    s.pending = { id: 1, cycle: 1, stage: "discovery", slot: 0, retry: 0 };
    s.attempts.push(s.pending);
    atomicJSON(file, s);
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(s);
    expect(existsSync(file + ".tmp")).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("paired acceptance holds small/uncertain effects and draw inflation", () => {
  const good = {
    baseline: [1, 1] as [number, number],
    candidate: [1, 0] as [number, number],
    baselineDraws: 0,
    candidateDraws: 0,
  };
  expect(evaluate(Array(8).fill(good)).accepted).toBe(true);
  expect(evaluate(Array(7).fill(good)).accepted).toBe(false);
  expect(evaluate(Array(8).fill({ ...good, candidate: [1, 1] })).accepted).toBe(false);
  expect(
    evaluate(Array(8).fill({ ...good, candidate: [0.5, 0.5], candidateDraws: 2 })).accepted,
  ).toBe(false);
  expect(
    evaluate([...Array(6).fill(good), ...Array(2).fill({ ...good, candidate: [1, 1] })]).accepted,
  ).toBe(false);
});

test("public result schema strips nothing silently and rejects arbitrary provider text", () => {
  const result = { ...terminal(), codeCommit: "a".repeat(40), requestHash: "b".repeat(64) };
  expect(parseResult(result)).toEqual(result);
  expect(parseResult({ ...result, providerPayload: "private" })).toBeNull();
  expect(parseResult({ ...result, reason: "arbitrary provider prose" })).toBeNull();
});
