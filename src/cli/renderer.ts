import type { GameState } from "../types";
import { getUnitStatus, getLivingUnits } from "../engine/game";

const UNIT_SYMBOLS: Record<string, string> = {
  sentinel: "S",
  specter: "G",
  oracle: "O",
  striker: "X",
  medic: "M",
  vector: "V",
};

// Colors
const C = {
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
  bgDim: "\x1b[48;5;236m",
  bgLight: "\x1b[48;5;238m",
};

function hpBar(hp: number, max: number, width = 10): string {
  const filled = Math.round((hp / max) * width);
  const empty = width - filled;
  const color = hp / max > 0.6 ? C.green : hp / max > 0.25 ? C.yellow : C.red;
  return `${color}${"█".repeat(filled)}${C.dim}${"░".repeat(empty)}${C.reset}`;
}

function facingArrow(facing: string): string {
  switch (facing) {
    case "N": return "↑";
    case "S": return "↓";
    case "E": return "→";
    case "W": return "←";
    default: return "·";
  }
}

export function renderFullState(state: GameState, actionLog: string[] = []): string {
  const lines: string[] = [];
  const W = 60;

  // Header
  lines.push("");
  lines.push(`${C.bold}${C.magenta}  ╔${"═".repeat(W - 4)}╗${C.reset}`);
  lines.push(`${C.bold}${C.magenta}  ║${" ".repeat(Math.floor((W - 22) / 2))}S I B Y L  —  Turn ${String(state.turn).padStart(2)}${" ".repeat(Math.ceil((W - 22) / 2))}║${C.reset}`);
  lines.push(`${C.bold}${C.magenta}  ╚${"═".repeat(W - 4)}╝${C.reset}`);
  lines.push("");

  // Grid
  lines.push(`${C.dim}     0   1   2   3   4   5${C.reset}`);
  lines.push(`${C.dim}   ┌${"───┬".repeat(5)}───┐${C.reset}`);

  for (let y = 5; y >= 0; y--) {
    let row = `${C.dim} ${y} │${C.reset}`;
    for (let x = 0; x < 6; x++) {
      const unit = state.units.find(
        (u) => u.hp > 0 && u.position.x === x && u.position.y === y
      );
      if (unit) {
        const color = unit.side === "player" ? C.cyan : C.red;
        const sym = UNIT_SYMBOLS[unit.class] || "?";
        const arrow = facingArrow(unit.facing);
        row += `${color}${sym}${arrow}${C.reset} ${C.dim}│${C.reset}`;
      } else {
        row += `${C.dim} · ${C.reset}${C.dim}│${C.reset}`;
      }
    }
    lines.push(row);
    if (y > 0) {
      lines.push(`${C.dim}   ├${"───┼".repeat(5)}───┤${C.reset}`);
    }
  }
  lines.push(`${C.dim}   └${"───┴".repeat(5)}───┘${C.reset}`);
  lines.push(`${C.dim}   ${C.cyan}■ Player${C.reset}  ${C.red}■ Enemy${C.reset}`);
  lines.push("");

  // Unit Roster
  for (const side of ["player", "opponent"] as const) {
    const color = side === "player" ? C.cyan : C.red;
    const label = side === "player" ? "YOUR SQUAD" : "ENEMY SQUAD";
    lines.push(`${color}${C.bold}  ── ${label} ${"─".repeat(W - label.length - 8)}${C.reset}`);

    for (const unit of state.units.filter((u) => u.side === side)) {
      const dead = unit.hp <= 0;
      const sym = UNIT_SYMBOLS[unit.class];
      const _status = getUnitStatus(unit);
      const bar = hpBar(unit.hp, unit.maxHp);
      const pos = `(${unit.position.x},${unit.position.y})`;
      const effects = unit.statusEffects.length
        ? ` ${C.yellow}[${unit.statusEffects.map((e) => e.type).join(", ")}]${C.reset}`
        : "";

      if (dead) {
        lines.push(`${C.dim}  ${sym} ${unit.name} (${unit.class}) — DEAD${C.reset}`);
      } else {
        lines.push(
          `  ${color}${sym}${C.reset} ${C.bold}${unit.name}${C.reset} ${C.dim}(${unit.class})${C.reset} at ${pos} ${facingArrow(unit.facing)}  ${bar} ${unit.hp}/${unit.maxHp}${effects}`
        );
      }
    }
    lines.push("");
  }

  // Action Log
  if (actionLog.length > 0) {
    lines.push(`${C.dim}${C.bold}  ── ACTIONS ${"─".repeat(W - 14)}${C.reset}`);
    for (const entry of actionLog) {
      lines.push(`  ${C.white}▸${C.reset} ${entry}`);
    }
    lines.push("");
  }

  // Game log (last 5)
  const recent = state.log.slice(-8);
  if (recent.length > 0) {
    lines.push(`${C.dim}${C.bold}  ── LOG ${"─".repeat(W - 11)}${C.reset}`);
    for (const entry of recent) {
      lines.push(`  ${C.dim}${entry}${C.reset}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function renderGameOver(state: GameState): string {
  const lines: string[] = [];
  lines.push("");
  if (state.winner === "player") {
    lines.push(`${C.bold}${C.green}  ╔═══════════════════════╗${C.reset}`);
    lines.push(`${C.bold}${C.green}  ║     🏆 VICTORY! 🏆    ║${C.reset}`);
    lines.push(`${C.bold}${C.green}  ╚═══════════════════════╝${C.reset}`);
  } else {
    lines.push(`${C.bold}${C.red}  ╔═══════════════════════╗${C.reset}`);
    lines.push(`${C.bold}${C.red}  ║     💀 DEFEAT. 💀     ║${C.reset}`);
    lines.push(`${C.bold}${C.red}  ╚═══════════════════════╝${C.reset}`);
  }

  // Survivors
  const survivors = getLivingUnits(state, state.winner);
  if (survivors.length > 0) {
    lines.push(`\n  ${C.dim}Survivors:${C.reset}`);
    for (const u of survivors) {
      lines.push(`    ${C.bold}${u.name}${C.reset} ${hpBar(u.hp, u.maxHp)} ${u.hp}/${u.maxHp}`);
    }
  }

  lines.push(`\n  ${C.dim}Battle lasted ${state.turn} turns.${C.reset}\n`);
  return lines.join("\n");
}

// Keep old exports for compatibility
export { renderFullState as renderTurn };
export function renderGrid(state: GameState): string { return renderFullState(state); }
export function renderUnitStatus(_state: GameState): string { return ""; }
export function renderLog(_state: GameState): string { return ""; }
