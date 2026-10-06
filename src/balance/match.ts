import { TypeSafeClient } from "@typesafe-ai/sdk";
import { appendFileSync, closeSync, fsyncSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyAction, decideAction, getPlacement } from "../agent/jev-agent";
import type { Boundary } from "../agent/jev-agent";
import {
  advanceRound,
  checkWinCondition,
  cleanupAfterUnitActs,
  createGame,
  createUnit,
  getNextUnit,
  placeUnit,
  startPlay,
  unitActed,
} from "../engine/game";
import { clearTrainingListener, setTrainingListener } from "../training/emitter";
import { BALANCE } from "../types";
import type { BalanceConfig, GameConfig, UnitAction } from "../types";
import { atomicJSON, hash, LIMITS, WHITELIST } from "./core";
import type { Failure, Result } from "./core";

export const CREDENTIAL_FILE = "/Users/emma/.hermes/cache/scratch/sibyl-jev.env";
export function credential(text: string): string {
  const lines = text.split(/\r?\n/).filter((l) => /^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=/.test(l));
  if (lines.length !== 1) throw Error("Credential file must contain exactly one TYPESAFE_API_KEY");
  let key = lines[0]!.replace(/^\s*(?:export\s+)?TYPESAFE_API_KEY\s*=\s*/, "").trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'")))
    key = key.slice(1, -1);
  if (!key || /[\s`$\\"']/.test(key)) throw Error("Invalid credential file value");
  return key;
}
export interface MatchRequest {
  config: GameConfig;
  balance: BalanceConfig;
  codeCommit: string;
  cycleHash: string;
  attempt: number;
}
export function applyBalance(value: BalanceConfig) {
  const expected = structuredClone(BALANCE);
  for (const [path, bounds] of Object.entries(WHITELIST)) {
    const [, cls, stat] = path.split(".");
    const n = (value.unitStats as any)?.[cls!]?.[stat!];
    if (!Number.isInteger(n) || n < bounds.min || n > bounds.max)
      throw Error("Invalid numeric balance override");
    (expected.unitStats as any)[cls!][stat!] = n;
  }
  if (hash(expected) !== hash(value)) throw Error("Non-whitelisted balance override");
  // Preserve UNIT_STATS alias held by engine imports.
  for (const cls of Object.keys(BALANCE.unitStats))
    Object.assign((BALANCE.unitStats as any)[cls], (value.unitStats as any)[cls]);
}
export function failureKind(error: unknown): Failure {
  const e = error as {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    message?: string;
  };
  if (e?.status === 502 || e?.statusCode === 502 || e?.response?.status === 502) return "http_502";
  return "provider_error";
}
/** No production simulator fallback: test injection is only at the provider boundary. */
function describe(action: UnitAction): string {
  switch (action.type) {
    case "move":
      return `move → (${action.target.x},${action.target.y})`;
    case "ability":
      return `${action.ability}${action.target ? ` → (${action.target.x},${action.target.y})` : ""}${action.direction ? ` facing ${action.direction}` : ""}`;
    case "wait":
      return "wait";
    default:
      return "?";
  }
}
export async function playMatch(
  request: MatchRequest,
  provider: Boundary,
  record: (event: unknown) => void,
): Promise<Result> {
  applyBalance(request.balance);
  const state = createGame();
  let decisions = 0,
    failedDecisions = 0;
  let failure: Failure | null = null;
  const client: Boundary = {
    systemOne: (async (...args: Parameters<Boundary["systemOne"]>) => {
      if (decisions >= LIMITS.decisions) {
        failure = "decision_cap";
        throw Error("Decision cap");
      }
      const id = ++decisions;
      record({
        type: "provider_start",
        id,
        round: state.round,
        unit: state.activeUnit,
        request: args[0],
      });
      try {
        const response = await provider.systemOne(...args);
        record({ type: "provider_response", id, response });
        return response;
      } catch (error) {
        failure = failureKind(error);
        failedDecisions++;
        // Do not serialize exceptions: SDK errors may include request headers.
        record({ type: "provider_failure", id, failure });
        throw Error("Provider decision failed");
      }
    }) as Boundary["systemOne"],
  };
  setTrainingListener((event) => record({ type: "engine_event", event }));
  try {
    record({ type: "game_config", ...request });
    for (const side of ["player", "opponent"] as const) {
      const squad = request.config[side];
      const placement = await getPlacement(squad.units, side, squad.placementPrompt, client);
      for (const pick of squad.units) {
        const p = placement.placements.find((p) => p.name === pick.name);
        if (!p) throw Error("Missing placement");
        const unit = createUnit(
          `${side}-${pick.name}`,
          pick.name,
          pick.class,
          side,
          p.position,
          pick.prompt,
        );
        const error = placeUnit(state, unit, p.position);
        if (error) throw Error("Rejected placement");
      }
    }
    startPlay(state);
    let lastRoundLog: string[] = [];
    while (state.phase === "play") {
      const roundLog: string[] = [];
      let unit = getNextUnit(state);
      while (unit) {
        const actions: string[] = [];
        // Same two-action sequencing as executeJevTurn/main, with each decision journaled.
        for (let actionIndex = 0; actionIndex < 2; actionIndex++) {
          const decision = await decideAction(state, unit, lastRoundLog, client);
          const error = applyAction(state, unit, decision.action);
          record({
            type: "resolved_action",
            unit: unit.id,
            actionIndex,
            action: decision.action,
            error,
          });
          if (error) throw Error("Rejected action");
          actions.push(describe(decision.action));
        }
        roundLog.push(`${unit.name}: ${actions.join(" → ")}`);
        cleanupAfterUnitActs(state, unit);
        unitActed(state);
        if (checkWinCondition(state)) break;
        unit = getNextUnit(state);
      }
      if ((state.phase as string) === "ended") break;
      lastRoundLog = roundLog;
      if (!advanceRound(state)) break;
    }
  } catch {
    if (!failure) {
      failure = "decision_error";
      failedDecisions++;
    }
    record({ type: "match_failure", failure, failedDecisions });
  } finally {
    clearTrainingListener();
  }
  const clean = failure === null && state.phase === "ended" && !!state.terminalReason;
  const result: Result = {
    clean,
    winner: clean ? (state.winner ?? "draw") : null,
    reason: state.terminalReason ?? null,
    rounds: state.round,
    decisions,
    failedDecisions,
    failure,
    codeCommit: request.codeCommit,
    requestHash: hash(request),
  };
  record({ type: "final_state", state, result });
  return result;
}

if (import.meta.main) {
  // Explicit worker entrypoint only. No dotenv import, environment fallback, or legacy recorder.
  delete process.env.TYPESAFE_API_KEY;
  const path = process.argv[2];
  if (!path) throw Error("Match request path required");
  const request = JSON.parse(readFileSync(path, "utf8")) as MatchRequest;
  const dir = resolve(path, "..");
  const fd = openSync(`${dir}/events.jsonl`, "ax", 0o600);
  const record = (value: unknown) => {
    appendFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  };
  try {
    applyBalance(request.balance);
    const apiKey = credential(readFileSync(CREDENTIAL_FILE, "utf8"));
    const result = await playMatch(
      request,
      new TypeSafeClient({
        apiKey,
        defaultModel: "jev-latest",
        baseURL: "https://api.typesafe.ai",
        logLevel: "off",
      }),
      record,
    );
    atomicJSON(`${dir}/result.json`, result);
  } catch {
    atomicJSON(`${dir}/result.json`, {
      clean: false,
      winner: null,
      reason: null,
      rounds: 0,
      decisions: 0,
      failedDecisions: 1,
      failure: "worker_error",
      codeCommit: request.codeCommit,
      requestHash: hash(request),
    } satisfies Result);
    process.exitCode = 1;
  } finally {
    closeSync(fd);
  }
}
