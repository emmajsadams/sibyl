import { z } from "zod";
import { BALANCE } from "../types";
import type { BalanceConfig, UnitClass } from "../types";
import { WHITELIST } from "./core";
import type { Quality } from "./v2-metrics";

export const ObjectiveSchema = z
  .strictObject({
    weights: z.strictObject({
      pacing: z.number().min(0).max(1),
      roles: z.number().min(0).max(1),
      diversity: z.number().min(0).max(1),
      imbalance: z.number().min(0).max(1),
    }),
    practicalEffect: z.number().positive().max(1),
    regressionTolerance: z.number().min(0).max(0.2),
    minBlocks: z.number().int().min(4).max(24),
    maxBlocks: z.number().int().min(4).max(24),
    looks: z.array(z.number().int().min(4).max(24)).min(1).max(6),
    seed: z.number().int().min(1).max(2147483647),
    bootstrapSamples: z.number().int().min(200).max(10000),
    durationRange: z.tuple([z.number().int().min(1).max(20), z.number().int().min(1).max(20)]),
    roleTargets: z.record(z.string(), z.number().positive().max(20)),
  })
  .superRefine((v, ctx) => {
    if (
      v.minBlocks > v.maxBlocks ||
      v.looks[0] !== v.minBlocks ||
      v.looks.at(-1) !== v.maxBlocks ||
      v.looks.some((n, i) => n > v.maxBlocks || (i > 0 && n <= v.looks[i - 1]!)) ||
      v.durationRange[0] > v.durationRange[1] ||
      Math.abs(Object.values(v.weights).reduce((a, b) => a + b, 0) - 1) > 1e-9 ||
      Object.keys(BALANCE.unitStats).some((c) => !v.roleTargets[c])
    )
      ctx.addIssue({ code: "custom", message: "Invalid declared objective" });
  });
export const defaultObjective = () =>
  ObjectiveSchema.parse({
    weights: { pacing: 0.3, roles: 0.3, diversity: 0.2, imbalance: 0.2 },
    practicalEffect: 0.03,
    regressionTolerance: 0.05,
    minBlocks: 8,
    maxBlocks: 24,
    looks: [8, 16, 24],
    seed: 1729,
    bootstrapSamples: 2000,
    durationRange: [6, 14],
    roleTargets: { medic: 2, oracle: 3, specter: 2, striker: 3, sentinel: 2, vector: 2 },
  });
export type Objective = z.infer<typeof ObjectiveSchema>;
export type Scores = {
  pacing: number;
  roles: number;
  diversity: number;
  imbalance: number;
  stalemate: number;
  steamroll: number;
  errors: number;
};
export type PairedBlock = { baseline: Scores; candidate: Scores };
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
/** Side-swapped pair, never individual games, is the resampling unit. */
export function scorePair(pair: [Quality, Quality], o: Objective): Scores {
  const values = pair.map((q) => {
    const present = Object.entries(q.classes).filter(([, r]) => r.units > 0);
    const utility = present.map(([cls, r]) =>
      Math.min(1, (r.damage + r.healing + r.kills + r.control) / (r.units * o.roleTargets[cls]!)),
    );
    const active = utility.filter((v) => v > 0).length / Math.max(1, utility.length);
    const [lo, hi] = o.durationRange;
    const pacing =
      Math.max(0, 1 - Math.max(0, lo - q.rounds, q.rounds - hi) / 20) *
      (q.stalemate || q.steamroll ? 0 : 1);
    // No class-v-class 50% target. Contribution diversity and broad side advantage are separate.
    return {
      pacing,
      roles: utility.reduce((a, b) => a + b, 0) / Math.max(1, utility.length),
      diversity: active,
      imbalance: 0,
      stalemate: Number(q.stalemate),
      steamroll: Number(q.steamroll),
      errors: q.actionErrors + q.policy.providerErrors + q.policy.decisionErrors,
    };
  });
  const result = Object.fromEntries(
    Object.keys(values[0]!).map((k) => [
      k,
      (values[0]![k as keyof Scores] + values[1]![k as keyof Scores]) / 2,
    ]),
  ) as Scores;
  const sideScore =
    pair.reduce(
      (sum, q) => sum + (q.winner === "player" ? 1 : q.winner === "opponent" ? 0 : 0.5),
      0,
    ) / 2;
  result.imbalance = Math.max(0, 1 - Math.max(0, Math.abs(sideScore - 0.5) - 0.25) * 4);
  return result;
}
export function evaluateV2(blocks: PairedBlock[], objective: Objective) {
  const o = ObjectiveSchema.parse(objective),
    n = blocks.length;
  if (n > o.maxBlocks) throw Error("Evaluation cap exceeded");
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const score = (s: Scores) =>
    Object.entries(o.weights).reduce((v, [k, w]) => v + w * s[k as keyof Scores], 0);
  const differences = blocks.map((b) => score(b.candidate) - score(b.baseline));
  const random = seeded(o.seed),
    samples: number[] = [];
  if (n)
    for (let i = 0; i < o.bootstrapSamples; i++) {
      let sum = 0;
      for (let j = 0; j < n; j++) sum += differences[Math.floor(random() * n)]!;
      samples.push(sum / n);
    }
  samples.sort((a, b) => a - b);
  const interval = n
    ? {
        mean: mean(differences),
        lower: samples[Math.floor(samples.length * 0.025)]!,
        upper: samples[Math.floor(samples.length * 0.975)]!,
      }
    : null;
  const regressions = n
    ? Object.fromEntries(
        ["pacing", "roles", "diversity", "imbalance", "stalemate", "steamroll", "errors"].map(
          (k) => [
            k,
            mean(blocks.map((b) => b.candidate[k as keyof Scores] - b.baseline[k as keyof Scores])),
          ],
        ),
      )
    : {};
  const gate = Object.entries(regressions).some(([k, d]) =>
    k === "errors"
      ? d > 0
      : ["stalemate", "steamroll"].includes(k)
        ? d > o.regressionTolerance
        : d < -o.regressionTolerance,
  );
  const declaredLook = o.looks.includes(n);
  const decision: "accepted" | "rejected" | "inconclusive" =
    !declaredLook || !interval
      ? "inconclusive"
      : gate
        ? "rejected"
        : interval.lower > o.practicalEffect
          ? "accepted"
          : interval.upper < -o.practicalEffect
            ? "rejected"
            : "inconclusive";
  return {
    decision,
    blocks: n,
    games: n * 4,
    interval,
    regressions,
    regressionGate: gate,
    declaredLook,
    atCap: n === o.maxBlocks,
    method:
      "exploratory paired-block percentile bootstrap; repeated looks are NOT confirmatory significance",
    seed: o.seed,
  };
}

const OWNER: Record<string, string> = {
  attack: "shared",
  shadowStrike: "specter",
  breach: "specter",
  cloak: "specter",
  precisionShot: "striker",
  scan: "oracle",
  suppressingFire: "striker",
  patch: "medic",
  overclock: "medic",
  trap: "vector",
  pulse: "vector",
};
export const V2_WHITELIST = Object.freeze({
  ...WHITELIST,
  ...Object.fromEntries(
    Object.entries(BALANCE.abilities).flatMap(([ability, knobs]) =>
      Object.keys(knobs).map((knob) => [
        `abilities.${ability}.${knob}`,
        {
          min: knob === "cooldown" ? 0 : 1,
          max: knob === "range" ? 4 : knob === "duration" ? 4 : knob === "maxUses" ? 3 : 4,
        },
      ]),
    ),
  ),
});
const text = z.string().min(1).max(1500);
export const ProposalSchema = z.strictObject({
  decision: z.enum(["hold", "propose", "manual_review"]),
  hypothesis: text,
  rationale: text,
  evidenceIds: z.array(z.string().max(200)).min(1).max(16),
  expectedEffects: z.array(text).min(1).max(8),
  changes: z
    .array(
      z.strictObject({
        path: z.enum(Object.keys(V2_WHITELIST) as [string, ...string[]]),
        value: z.number().int(),
      }),
    )
    .max(2),
  manualReview: z.array(text).max(8),
});
export const DESIGNER_SCHEMA = z.toJSONSchema(ProposalSchema);
export function validateBalance(value: BalanceConfig, anchor: BalanceConfig) {
  const expected = structuredClone(anchor);
  for (const [path, bounds] of Object.entries(V2_WHITELIST)) {
    const [section, key, stat] = path.split(".") as ["unitStats" | "abilities", string, string];
    const n = (value[section] as any)?.[key]?.[stat];
    if (!Number.isInteger(n) || n < bounds.min || n > bounds.max)
      throw Error("Invalid numeric balance");
    (expected[section] as any)[key][stat] = n;
  }
  if (JSON.stringify(expected) !== JSON.stringify(value)) throw Error("Non-whitelisted balance");
  return expected;
}
export function validateProposal(value: unknown, base: BalanceConfig, evidenceIds: string[]) {
  const proposal = ProposalSchema.parse(value);
  if (proposal.evidenceIds.some((id) => !evidenceIds.includes(id)))
    throw Error("Unknown evidence ID");
  if (proposal.decision !== "propose" && proposal.changes.length)
    throw Error("Hold/manual review cannot apply changes");
  if (proposal.decision === "propose" && !proposal.changes.length) throw Error("Empty candidate");
  if (proposal.decision === "manual_review" && !proposal.manualReview.length)
    throw Error("Missing review request");
  const balance = structuredClone(base),
    owners = new Set<string>(),
    paths = new Set<string>();
  for (const change of proposal.changes) {
    const [section, key, stat] = change.path.split(".") as [
      "unitStats" | "abilities",
      UnitClass,
      string,
    ];
    if (paths.has(change.path)) throw Error("Duplicate path");
    paths.add(change.path);
    owners.add(section === "unitStats" ? key : OWNER[key]!);
    const before = (base[section] as any)[key][stat];
    if (
      change.value === before ||
      !(Math.abs(change.value - before) <= 1 || Math.abs(change.value - before) / before <= 0.15)
    )
      throw Error("Unbounded change");
    (balance[section] as any)[key][stat] = change.value;
  }
  if (owners.size > 1) throw Error("Changes must concern one role or one shared ability");
  validateBalance(balance, base);
  return { proposal, balance };
}
