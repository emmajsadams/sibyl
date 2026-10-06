import { z } from "zod";
import { createHash } from "node:crypto";
import { closeSync, fsyncSync, openSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { BALANCE } from "../types";
import type { BalanceConfig, GameConfig, Side, UnitClass } from "../types";

export const LIMITS = Object.freeze({
  cycles: 10,
  discovery: 50,
  evaluation: 32,
  attempts: 800,
  decisions: 1000,
  retries502: 2,
  consecutiveFailures: 3,
  wallMs: 12 * 60 * 60 * 1000,
  matchMs: 45 * 60 * 1000,
  designerMs: 10 * 60 * 1000,
});
export const CLASSES = Object.keys(BALANCE.unitStats) as UnitClass[];
// Frozen scientific scope: no abilities, mechanics, rounds, grid or prompts.
export const WHITELIST = Object.freeze(
  Object.fromEntries(
    CLASSES.flatMap((c) =>
      ["maxHp", "movement", "range", "speed"].map((s) => [
        `unitStats.${c}.${s}`,
        { min: 1, max: s === "maxHp" ? 20 : s === "speed" ? 3 : 6 },
      ]),
    ),
  ),
);
export type Proposal = {
  decision: "hold" | "propose";
  path: string | null;
  value: number | null;
  reason: "insufficient_evidence" | "class_imbalance" | "no_safe_change";
};
export const PROPOSAL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "path", "value", "reason"],
  properties: {
    decision: { type: "string", enum: ["hold", "propose"] },
    path: { type: ["string", "null"], enum: [null, ...Object.keys(WHITELIST)] },
    value: { type: ["number", "null"] },
    reason: {
      type: "string",
      enum: ["insufficient_evidence", "class_imbalance", "no_safe_change"],
    },
  },
};
export function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function atomicJSON(path: string, value: unknown): void {
  const temp = `${path}.tmp`;
  const fd = openSync(temp, "w", 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, path);
  const dir = openSync(dirname(path), "r");
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
export function swapped(config: GameConfig): GameConfig {
  return structuredClone({ player: config.opponent, opponent: config.player });
}
export function candidateBalance(base: BalanceConfig, proposal: Proposal): BalanceConfig {
  if (
    !proposal ||
    Object.keys(proposal).sort().join() !== "decision,path,reason,value" ||
    !["insufficient_evidence", "class_imbalance", "no_safe_change"].includes(proposal.reason)
  )
    throw Error("Invalid proposal schema");
  if (proposal.decision === "hold") {
    if (proposal.path !== null || proposal.value !== null) throw Error("Hold cannot change a stat");
    return structuredClone(base);
  }
  if (
    proposal.decision !== "propose" ||
    !proposal.path ||
    !Object.hasOwn(WHITELIST, proposal.path) ||
    !Number.isFinite(proposal.value)
  )
    throw Error("Proposal outside whitelist");
  const [, cls, stat] = proposal.path.split(".") as [
    string,
    UnitClass,
    keyof BalanceConfig["unitStats"][UnitClass],
  ];
  const before = base.unitStats[cls][stat];
  const value = proposal.value!;
  const bounds = WHITELIST[proposal.path]!;
  if (
    !Number.isInteger(value) ||
    value < bounds.min ||
    value > bounds.max ||
    value === before ||
    !(Math.abs(value - before) <= 1 || Math.abs(value - before) / before <= 0.15)
  )
    throw Error("Unbounded numeric proposal");
  const result = structuredClone(base);
  result.unitStats[cls][stat] = value;
  return result;
}
export type Failure =
  | "http_502"
  | "provider_error"
  | "decision_error"
  | "decision_cap"
  | "timeout"
  | "interrupted"
  | "worker_error";
export interface Result {
  clean: boolean;
  winner: Side | "draw" | null;
  reason: string | null;
  rounds: number;
  decisions: number;
  failedDecisions: number;
  failure: Failure | null;
  codeCommit: string;
  requestHash: string;
}
const resultSchema = z.strictObject({
  clean: z.boolean(),
  winner: z.enum(["player", "opponent", "draw"]).nullable(),
  reason: z
    .string()
    .max(300)
    .regex(
      /^(All (player|opponent) units eliminated|Stalemate after 20 rounds — (draw \(\d+ HP each\)|(?:player|opponent) wins by HP \(\d+ vs \d+\)))$/,
    )
    .nullable(),
  rounds: z.number().int().min(0).max(20),
  decisions: z.number().int().min(0).max(LIMITS.decisions),
  failedDecisions: z
    .number()
    .int()
    .min(0)
    .max(LIMITS.decisions + 1),
  failure: z
    .enum([
      "http_502",
      "provider_error",
      "decision_error",
      "decision_cap",
      "timeout",
      "interrupted",
      "worker_error",
    ])
    .nullable(),
  codeCommit: z.string().regex(/^[a-f0-9]{40}$/),
  requestHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export function parseResult(value: unknown): Result | null {
  const parsed = resultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export function isClean(r: Result): boolean {
  return (
    r.clean === true &&
    r.failure === null &&
    r.failedDecisions === 0 &&
    Number.isInteger(r.decisions) &&
    r.decisions > 0 &&
    r.decisions <= LIMITS.decisions &&
    ["player", "opponent", "draw"].includes(r.winner ?? "") &&
    typeof r.reason === "string" &&
    r.reason.length > 0 &&
    r.rounds > 0 &&
    r.rounds <= 20
  );
}
export interface Attempt {
  id: number;
  cycle: number;
  stage: "discovery" | "evaluation";
  slot: number;
  retry: number;
  result?: Result;
}
export interface Checkpoint {
  version: 1;
  startedAt: number;
  cycle: number;
  attempts: Attempt[];
  consecutiveFailures: number;
  manifestHashes: Record<string, string>;
  pending: Attempt | null;
  halted: string | null;
  complete: boolean;
}
export function guard(s: Checkpoint, now = Date.now(), needsAttempt = true) {
  if (s.halted) throw Error(`Experiment halted: ${s.halted}`);
  if (now - s.startedAt >= LIMITS.wallMs) throw Error("12-hour wall cap");
  if (needsAttempt && s.attempts.length >= LIMITS.attempts) throw Error("800-attempt cap");
  if (s.consecutiveFailures >= LIMITS.consecutiveFailures)
    throw Error("Three consecutive failed games");
}
export function settle(s: Checkpoint, result: Result) {
  if (!s.pending) throw Error("No pending attempt");
  const attempt = s.attempts.find((a) => a.id === s.pending!.id);
  if (!attempt || attempt.result) throw Error("Attempt already settled or missing");
  attempt.result = result;
  s.consecutiveFailures = isClean(result) ? 0 : s.consecutiveFailures + 1;
  s.pending = null;
  if (s.consecutiveFailures >= LIMITS.consecutiveFailures)
    s.halted = "Three consecutive failed games";
  else if (
    !isClean(result) &&
    (!["http_502", "timeout"].includes(result.failure ?? "") || attempt.retry >= LIMITS.retries502)
  )
    s.halted = "Non-retryable or exhausted failed game";
}
export function counts(s: Checkpoint) {
  return {
    attempts: s.attempts.length,
    discovery: s.attempts.filter((a) => a.stage === "discovery" && a.result && isClean(a.result))
      .length,
    evaluation: s.attempts.filter((a) => a.stage === "evaluation" && a.result && isClean(a.result))
      .length,
    failed: s.attempts.filter((a) => a.result && !isClean(a.result)).length,
  };
}
export function classScore(
  config: GameConfig,
  winner: Result["winner"],
  cls: UnitClass,
): number | null {
  const p = config.player.units.some((u) => u.class === cls),
    o = config.opponent.units.some((u) => u.class === cls);
  if (p === o || winner === null) return null;
  return winner === "draw" ? 0.5 : winner === (p ? "player" : "opponent") ? 1 : 0;
}
export function uncertainty(xs: number[]) {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  return {
    n: xs.length,
    mean,
    lower: mean - (2.365 * sd) / Math.sqrt(xs.length),
    upper: mean + (2.365 * sd) / Math.sqrt(xs.length),
  };
}
/** Eight independent matched config blocks, each baseline/candidate in both orientations.
 * Deliberately conservative exploratory gate, not a claim of population significance.
 */
export function evaluate(
  blocks: {
    baseline: [number, number];
    candidate: [number, number];
    baselineDraws: number;
    candidateDraws: number;
  }[],
) {
  if (blocks.length !== 8) return { accepted: false, reason: "insufficient_evidence" };
  const b = blocks.map((x) => (x.baseline[0] + x.baseline[1]) / 2),
    c = blocks.map((x) => (x.candidate[0] + x.candidate[1]) / 2);
  const improvements = b.map((v, i) => Math.abs(v - 0.5) - Math.abs(c[i]! - 0.5));
  const ci = uncertainty(improvements);
  const biasBefore = Math.abs(b.reduce((a, v) => a + v, 0) / 8 - 0.5),
    biasAfter = Math.abs(c.reduce((a, v) => a + v, 0) / 8 - 0.5);
  const wins = improvements.filter((v) => v > 0).length;
  const losses = improvements.filter((v) => v < 0).length;
  const drawsBefore = blocks.reduce((n, x) => n + x.baselineDraws, 0),
    drawsAfter = blocks.reduce((n, x) => n + x.candidateDraws, 0);
  const accepted =
    ci.lower > 0.05 &&
    biasBefore - biasAfter >= 0.1 &&
    wins >= 7 &&
    losses === 0 &&
    drawsAfter <= drawsBefore;
  return {
    accepted,
    reason: accepted ? "paired_gate_passed" : "inconclusive_hold",
    ci,
    biasBefore,
    biasAfter,
    wins,
    losses,
    drawsBefore,
    drawsAfter,
  };
}
