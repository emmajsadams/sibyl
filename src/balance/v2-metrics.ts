import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import type { UnitClass } from "../types";
import { CLASSES } from "./core";

const role = () => ({
  units: 0,
  damage: 0,
  friendlyDamage: 0,
  healing: 0,
  control: 0,
  statusExposureRounds: 0,
  kills: 0,
  deaths: 0,
  survivors: 0,
  survivalRounds: 0,
});
const impact = () => ({
  uses: 0,
  errors: 0,
  damage: 0,
  healing: 0,
  kills: 0,
  statusApplications: 0,
  breaches: 0,
  promptRewrites: 0,
});
/** Counts observable outcomes, not causal ability value or LLM certainty. No prompt strings retained. */
export class QualityCollector {
  private line = 0;
  private round = 0;
  private units = new Map<string, { class: UnitClass; side: string; alive: boolean }>();
  private ended = false;
  private directImpact = false;
  private rewritten = new Set<string>();
  private refs: { id: string; type: string }[] = [];
  private classes = Object.fromEntries(CLASSES.map((c) => [c, role()])) as Record<
    UnitClass,
    ReturnType<typeof role>
  >;
  private abilities: Record<string, ReturnType<typeof impact>> = {};
  private waits = 0;
  private actions = 0;
  private errors = 0;
  private early = 0;
  private policy = {
    providerErrors: 0,
    decisionErrors: 0,
    rewrittenPromptActions: 0,
    rewrittenPromptWaits: 0,
    zeroDirectImpactAbilities: 0,
  };
  private winner: "player" | "opponent" | "draw" | null = null;
  private stalemate = false;
  constructor(readonly evidenceId: string) {}
  private ability(name: string) {
    return (this.abilities[name] ??= impact());
  }
  add(raw: any) {
    this.line++;
    if (raw.type === "provider_failure") this.policy.providerErrors++;
    if (raw.type === "match_failure" && raw.failure === "decision_error")
      this.policy.decisionErrors++;
    if (raw.type === "resolved_action") {
      this.actions++;
      if (raw.error) this.errors++;
      if (raw.action?.type === "wait") this.waits++;
      if (this.rewritten.has(raw.unit)) {
        this.policy.rewrittenPromptActions++;
        if (raw.action?.type === "wait") this.policy.rewrittenPromptWaits++;
      }
      if (raw.action?.type === "ability") {
        const a = this.ability(raw.action.ability);
        a.uses++;
        if (raw.error) a.errors++;
        if (!this.directImpact && !raw.error) this.policy.zeroDirectImpactAbilities++;
      }
      this.directImpact = false;
      return;
    }
    if (raw.type !== "engine_event") return;
    const e = raw.event;
    if (!e || typeof e.type !== "string") return;
    if (e.type === "game_start")
      for (const u of e.units) {
        this.units.set(u.id, { class: u.class, side: u.side, alive: true });
        this.classes[u.class as UnitClass].units++;
      }
    if (e.type === "turn_start") {
      this.round = e.turn;
      for (const u of e.units ?? [])
        if (u.hp > 0)
          this.classes[u.class as UnitClass].statusExposureRounds += u.statusEffects.length;
    }
    const source = this.units.get(e.sourceId ?? e.killerId ?? e.attackerId);
    const target = this.units.get(e.targetId ?? e.unitId);
    if (e.type === "damage_dealt") {
      this.ability(e.ability).damage += e.amount;
      if (source) {
        const r = this.classes[source.class];
        if (source.side === target?.side) r.friendlyDamage += e.amount;
        else r.damage += e.amount;
      }
    }
    if (e.type === "healing_done") {
      if (source) this.classes[source.class].healing += e.amount;
      this.ability("patch").healing += e.amount;
    }
    if (e.type === "unit_killed" && target?.alive) {
      target.alive = false;
      this.classes[target.class].deaths++;
      this.classes[target.class].survivalRounds += this.round;
      if (source && source.side !== target.side) this.classes[source.class].kills++;
      this.ability(e.ability).kills++;
      if (this.round <= 3) this.early++;
    }
    if (e.type === "status_applied") {
      this.ability(e.source).statusApplications++;
      if (["shield_wall", "cloak"].includes(e.source) && target)
        this.classes[target.class].control++;
    }
    if (e.type === "breach") {
      this.ability("breach").breaches++;
      this.rewritten.add(e.targetId);
      if (source) this.classes[source.class].control++;
    }
    if (e.type === "prompt_recalibrated") {
      this.ability("recalibrate").promptRewrites++;
      this.rewritten.add(e.targetId);
      if (source) this.classes[source.class].control++;
    }
    if (e.type === "denial_blocked") {
      const vector = this.units.get(e.vectorId);
      if (vector) this.classes[vector.class].control++;
      this.ability("denial").statusApplications++;
    }
    if (e.type === "status_removed" && /breach/.test(e.effectType)) this.rewritten.delete(e.unitId);
    if (
      [
        "damage_dealt",
        "healing_done",
        "breach",
        "prompt_recalibrated",
        "status_applied",
        "trap_placed",
      ].includes(e.type)
    )
      this.directImpact = true;
    if (e.type === "ability_used" && e.ability === "recalibrate" && e.success)
      this.ability("recalibrate").promptRewrites++;
    if (e.type === "game_end") {
      this.ended = true;
      this.winner = e.winner ?? "draw";
      this.round = e.totalTurns;
      this.stalemate = e.reason.startsWith("Stalemate");
    }
    if (
      [
        "damage_dealt",
        "healing_done",
        "unit_killed",
        "breach",
        "status_applied",
        "status_removed",
        "game_end",
      ].includes(e.type) &&
      this.refs.length < 32
    )
      this.refs.push({ id: `${this.evidenceId}:L${this.line}`, type: e.type });
  }
  finish() {
    const classes = structuredClone(this.classes);
    for (const u of this.units.values())
      if (u.alive) {
        classes[u.class].survivors++;
        classes[u.class].survivalRounds += this.round;
      }
    const living = [...this.units.values()].filter((u) => u.alive);
    const initial = this.units.size;
    const teams = Object.fromEntries(
      ["player", "opponent"].map((side) => [
        side,
        [...this.units.values()]
          .filter((u) => u.side === side)
          .map((u) => u.class)
          .sort(),
      ]),
    );
    return {
      evidenceId: this.evidenceId,
      teams,
      complete: this.ended,
      winner: this.winner,
      rounds: this.round,
      stalemate: this.stalemate,
      earlyEliminations: this.early,
      earlyEliminationRate: initial ? this.early / initial : 0,
      steamroll: this.ended && !this.stalemate && this.round <= 5 && living.length >= initial / 2,
      actions: this.actions,
      waits: this.waits,
      actionErrors: this.errors,
      waitRate: this.actions ? this.waits / this.actions : 0,
      classes,
      abilities: structuredClone(this.abilities),
      policy: { ...this.policy },
      references: this.refs,
      limitations: [
        "Waits are a wasted-action proxy, not necessarily mistakes.",
        "Prompt-rewrite exposure/wait rate is a prompt-following proxy, not semantic compliance, causality, or LLM certainty.",
        "Status counts are observed applications, not counterfactual impact; trap damage is not always attributed by the engine.",
      ],
    };
  }
}
export type Quality = ReturnType<QualityCollector["finish"]>;
export function summarizeQuality(evidence: Quality[]) {
  const n = evidence.length,
    average = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const rounds = evidence.map((q) => q.rounds).sort((a, b) => a - b);
  const classes = Object.fromEntries(
    CLASSES.map((cls) => [
      cls,
      Object.fromEntries(
        Object.keys(role()).map((k) => [
          k,
          evidence.reduce((sum, q) => sum + q.classes[cls][k as keyof ReturnType<typeof role>], 0),
        ]),
      ),
    ]),
  );
  const compositions: Record<string, { appearances: number; wins: number; draws: number }> = {};
  for (const q of evidence)
    for (const side of ["player", "opponent"]) {
      const key = q.teams[side]?.join("+") ?? "unknown";
      const count = (compositions[key] ??= { appearances: 0, wins: 0, draws: 0 });
      count.appearances++;
      if (q.winner === side) count.wins++;
      if (q.winner === "draw") count.draws++;
    }
  return {
    games: n,
    duration: {
      mean: average(rounds),
      median: rounds.length ? rounds[Math.floor(rounds.length / 2)] : null,
      min: rounds[0] ?? null,
      max: rounds.at(-1) ?? null,
    },
    stalemateRate: average(evidence.map((q) => Number(q.stalemate))),
    steamrollRate: average(evidence.map((q) => Number(q.steamroll))),
    earlyEliminationRate: average(evidence.map((q) => q.earlyEliminationRate)),
    waitRate: average(evidence.map((q) => q.waitRate)),
    classes,
    compositions,
    coverageWarning:
      "Composition outcomes are descriptive, sparse and confounded by policy/opponents; intentional counters are allowed. No per-matchup 50% target.",
  };
}

/** Bound memory even for historical exponential prompt lines; skipped lines are counted. */
export async function journalQuality(path: string, id: string) {
  const c = new QualityCollector(id);
  const digest = createHash("sha256");
  let buffer = "",
    oversized = false,
    skippedLines = 0;
  for await (const chunk of createReadStream(path, { encoding: "utf8", highWaterMark: 65536 })) {
    digest.update(chunk);
    for (const [i, part] of String(chunk).split("\n").entries()) {
      if (i > 0) {
        if (oversized) {
          skippedLines++;
          c.add({ type: "skipped" });
        } else if (buffer) {
          try {
            c.add(JSON.parse(buffer));
          } catch {
            throw Error("Torn journal; not clean evidence");
          }
        }
        buffer = "";
        oversized = false;
      }
      if (!oversized) {
        buffer += part;
        if (buffer.length > 1024 * 1024) {
          oversized = true;
          buffer = "";
        }
      }
    }
  }
  if (buffer || oversized) throw Error("Journal missing final newline");
  return { ...c.finish(), skippedLines, journalHash: digest.digest("hex") };
}
