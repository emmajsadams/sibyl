/**
 * Game logger — writes structured JSON log + human-readable summary
 * to runs/ directory after each game.
 */

import { writeFileSync, mkdirSync } from "fs";
import type { GameState, Unit, Side, UnitAction, Position } from "./types";
import { BALANCE } from "./types";

export interface GameLog {
  id: string;
  startedAt: string;
  endedAt?: string;
  agent: "api" | "cli";
  config?: string;
  balance?: typeof BALANCE;
  player: SquadLog;
  opponent: SquadLog;
  turns: TurnLog[];
  result: {
    winner: Side | "draw";
    totalTurns: number;
    reason: string;
  };
}

interface SquadLog {
  units: { name: string; class: string; prompt: string }[];
}

export interface TurnLog {
  turn: number;
  side: Side;
  actions: UnitTurnLog[];
  stateAfter: UnitSnapshot[];
}

interface UnitTurnLog {
  unit: string;
  class: string;
  thinking: string;
  firstAction: UnitAction;
  firstResult: string | null; // null = success, string = error
  secondAction: UnitAction;
  secondResult: string | null;
}

interface UnitSnapshot {
  name: string;
  class: string;
  side: Side;
  hp: number;
  maxHp: number;
  position: Position;
  alive: boolean;
}

export class GameLogger {
  private log: GameLog;
  private currentTurn: TurnLog | null = null;

  constructor(agent: "api" | "cli", config?: string) {
    const now = new Date();
    this.log = {
      id: `${now.toISOString().replace(/[:.]/g, "-").slice(0, 19)}`,
      startedAt: now.toISOString(),
      agent,
      config,
      balance: BALANCE,
      player: { units: [] },
      opponent: { units: [] },
      turns: [],
      result: { winner: "draw", totalTurns: 0, reason: "" },
    };
  }

  setSquad(side: Side, units: { name: string; class: string; prompt: string }[]) {
    this.log[side] = { units };
  }

  startTurn(turn: number, side: Side) {
    this.currentTurn = { turn, side, actions: [], stateAfter: [] };
  }

  logAction(
    unit: Unit,
    thinking: string,
    firstAction: UnitAction,
    firstResult: string | null,
    secondAction: UnitAction,
    secondResult: string | null,
  ) {
    if (!this.currentTurn) return;
    this.currentTurn.actions.push({
      unit: unit.name,
      class: unit.class,
      thinking,
      firstAction,
      firstResult,
      secondAction,
      secondResult,
    });
  }

  logError(unit: Unit, error: string) {
    if (!this.currentTurn) return;
    this.currentTurn.actions.push({
      unit: unit.name,
      class: unit.class,
      thinking: "",
      firstAction: { type: "wait" },
      firstResult: error,
      secondAction: { type: "wait" },
      secondResult: null,
    });
  }

  endTurn(state: GameState) {
    if (!this.currentTurn) return;
    this.currentTurn.stateAfter = state.units.map((u) => ({
      name: u.name,
      class: u.class,
      side: u.side,
      hp: u.hp,
      maxHp: u.maxHp,
      position: { ...u.position },
      alive: u.hp > 0,
    }));
    this.log.turns.push(this.currentTurn);
    this.currentTurn = null;
  }

  finish(state: GameState, reason: string) {
    this.log.endedAt = new Date().toISOString();
    this.log.result = {
      winner: state.winner || "draw",
      totalTurns: state.turn,
      reason,
    };
    this.save();
  }

  private save() {
    mkdirSync("runs", { recursive: true });
    const base = `runs/${this.log.id}`;

    // JSON log
    writeFileSync(`${base}.json`, JSON.stringify(this.log, null, 2));

    // Human-readable summary
    const lines: string[] = [];
    lines.push(`# SIBYL Game Log — ${this.log.id}`);
    lines.push(`Agent: ${this.log.agent} | Config: ${this.log.config || "interactive"}`);
    lines.push(`Started: ${this.log.startedAt}`);
    lines.push(`Ended: ${this.log.endedAt}`);
    lines.push("");

    lines.push("## Squads");
    lines.push(`### Player`);
    for (const u of this.log.player.units) {
      lines.push(`- **${u.name}** (${u.class}): "${u.prompt}"`);
    }
    lines.push(`### Opponent`);
    for (const u of this.log.opponent.units) {
      lines.push(`- **${u.name}** (${u.class}): "${u.prompt}"`);
    }
    lines.push("");

    lines.push("## Turns");
    for (const turn of this.log.turns) {
      lines.push(`### Turn ${turn.turn} — ${turn.side}`);
      for (const a of turn.actions) {
        const a1 = descAction(a.firstAction);
        const a2 = descAction(a.secondAction);
        const r1 = a.firstResult ? ` ✗ ${a.firstResult}` : " ✓";
        const r2 = a.secondResult ? ` ✗ ${a.secondResult}` : " ✓";
        lines.push(`- **${a.unit}** (${a.class}): ${a1}${r1} → ${a2}${r2}`);
        if (a.thinking) lines.push(`  💭 ${a.thinking}`);
      }

      // HP snapshot
      const alive = turn.stateAfter.filter((u) => u.alive);
      const dead = turn.stateAfter.filter((u) => !u.alive);
      lines.push(
        `  State: ${alive.map((u) => `${u.name} ${u.hp}/${u.maxHp}`).join(", ")}${dead.length ? ` | Dead: ${dead.map((u) => u.name).join(", ")}` : ""}`,
      );
      lines.push("");
    }

    lines.push("## Result");
    lines.push(
      `**${this.log.result.winner === "draw" ? "DRAW" : this.log.result.winner.toUpperCase() + " WINS"}** — ${this.log.result.reason}`,
    );
    lines.push(`Total turns: ${this.log.result.totalTurns}`);

    writeFileSync(`${base}.md`, lines.join("\n"));
    console.error(`\n  [log] Saved: ${base}.json + ${base}.md`);
  }
}

function descAction(action: UnitAction): string {
  switch (action.type) {
    case "move":
      return `move(${action.target.x},${action.target.y})`;
    case "ability":
      return `${action.ability}${action.target ? `(${action.target.x},${action.target.y})` : ""}${action.direction ? ` ${action.direction}` : ""}`;
    case "wait":
      return "wait";
    default:
      return "?";
  }
}
