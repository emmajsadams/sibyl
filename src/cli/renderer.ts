import type { GameState, Unit, Position } from "../types";
import { getUnitStatus, getLivingUnits } from "../engine/game";

const UNIT_SYMBOLS: Record<string, string> = {
  sentinel: "S",
  specter: "G", // Ghost
  oracle: "O",
  striker: "X",
  medic: "M",
  vector: "V",
};

const PLAYER_COLOR = "\x1b[36m"; // cyan
const OPPONENT_COLOR = "\x1b[31m"; // red
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const YELLOW = "\x1b[33m";

export function renderGrid(state: GameState): string {
  const lines: string[] = [];
  lines.push(`${DIM}  0 1 2 3 4 5${RESET}`);

  for (let y = 5; y >= 0; y--) {
    let row = `${DIM}${y}${RESET} `;
    for (let x = 0; x < 6; x++) {
      const unit = state.units.find(
        (u) => u.hp > 0 && u.position.x === x && u.position.y === y
      );
      if (unit) {
        const color = unit.side === "player" ? PLAYER_COLOR : OPPONENT_COLOR;
        const sym = UNIT_SYMBOLS[unit.class] || "?";
        row += `${color}${sym}${RESET} `;
      } else {
        row += `${DIM}.${RESET} `;
      }
    }
    lines.push(row);
  }

  return lines.join("\n");
}

export function renderUnitStatus(state: GameState): string {
  const lines: string[] = [];

  for (const side of ["player", "opponent"] as const) {
    const color = side === "player" ? PLAYER_COLOR : OPPONENT_COLOR;
    const label = side === "player" ? "YOUR SQUAD" : "ENEMY SQUAD";
    lines.push(`${color}${BOLD}── ${label} ──${RESET}`);

    for (const unit of state.units.filter((u) => u.side === side)) {
      const status = getUnitStatus(unit);
      const hpBar = renderHpBar(unit.hp, unit.maxHp);
      const dead = unit.hp <= 0 ? ` ${DIM}[DEAD]${RESET}` : "";
      const effects = unit.statusEffects.length
        ? ` ${DIM}(${unit.statusEffects.map((e) => e.type).join(", ")})${RESET}`
        : "";
      lines.push(
        `  ${color}${UNIT_SYMBOLS[unit.class]}${RESET} ${unit.name} ${hpBar}${dead}${effects}`
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderHpBar(hp: number, max: number): string {
  const filled = Math.round((hp / max) * 8);
  const empty = 8 - filled;
  const color = hp / max > 0.6 ? "\x1b[32m" : hp / max > 0.25 ? YELLOW : "\x1b[31m";
  return `${color}${"█".repeat(filled)}${DIM}${"░".repeat(empty)}${RESET} ${hp}/${max}`;
}

export function renderLog(state: GameState, count = 5): string {
  const recent = state.log.slice(-count);
  if (recent.length === 0) return "";
  return `${DIM}── LOG ──${RESET}\n${recent.map((l) => `  ${l}`).join("\n")}`;
}

export function renderTurn(state: GameState): string {
  const parts = [
    `\n${BOLD}Turn ${state.turn} — ${state.activesSide === "player" ? "YOUR" : "ENEMY"} TURN${RESET}\n`,
    renderGrid(state),
    "",
    renderUnitStatus(state),
    renderLog(state),
  ];
  return parts.join("\n");
}
