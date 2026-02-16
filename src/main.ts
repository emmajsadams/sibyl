import {
  createGame,
  createUnit,
  placeUnit,
  startPlay,
  endTurn,
  moveUnit,
  useAbility,
  getLivingUnits,
  buildGameContext,
} from "./engine/game";
import * as apiAgent from "./agent/agent";
import * as cliAgent from "./agent/cli-agent";
import { renderFullState, renderGameOver } from "./cli/renderer";

// Select agent backend based on --cli flag
const USE_CLI = process.argv.includes("--cli");
const { getUnitAction, getPlacement } = USE_CLI ? cliAgent : apiAgent;
import { ask, askMultiline, close } from "./cli/input";
import { GameLogger } from "./logger";
import { TrainingRecorder } from "./training/recorder";
import { setTrainingListener, emit as emitTraining } from "./training/emitter";
import type { GameState, UnitClass, Side, Unit, UnitAction } from "./types";
import { readFileSync } from "fs";

const CLASSES: UnitClass[] = [
  "sentinel", "specter", "oracle", "striker", "medic", "vector",
];

// === Config ===

interface UnitConfig {
  name: string;
  class: UnitClass;
  prompt: string;
}

interface SideConfig {
  units: UnitConfig[];
  placementPrompt: string;
}

interface GameConfig {
  player: SideConfig;
  opponent: SideConfig;
}

function loadConfig(path: string): GameConfig {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// === Interactive ===

async function selectSquad(): Promise<UnitConfig[]> {
  console.log("\n\x1b[1m═══ SIBYL — SQUAD SELECTION ═══\x1b[0m\n");
  console.log("Available units:");
  CLASSES.forEach((c, i) => console.log(`  ${i + 1}. ${c.toUpperCase()}`));
  console.log();

  const picks: UnitConfig[] = [];
  for (let i = 0; i < 3; i++) {
    const input = await ask(`Pick unit ${i + 1} (1-6): `);
    const idx = parseInt(input) - 1;
    const cls = (idx >= 0 && idx < CLASSES.length) ? CLASSES[idx]! : "sentinel" as UnitClass;
    const name = await ask(`Name for your ${cls}: `);
    console.log(`\x1b[36m${name || cls}\x1b[0m (${cls.toUpperCase()}) — write prompt:`);
    const prompt = await askMultiline("> ");
    picks.push({ name: name || `${cls}-${i + 1}`, class: cls, prompt });
    console.log();
  }
  return picks;
}

// === Placement ===

async function runPlacementPhase(
  state: GameState,
  playerUnits: UnitConfig[],
  playerPlacementPrompt: string,
  opponentUnits: UnitConfig[],
  opponentPlacementPrompt: string,
  interactive: boolean
): Promise<void> {
  console.log("\n\x1b[1m═══ PLACEMENT PHASE ═══\x1b[0m\n");

  if (interactive) {
    console.log("Place your units in rows 0-1 (bottom). Grid: x 0-5.\n");
    for (const pick of playerUnits) {
      const input = await ask(`Place ${pick.name} (${pick.class}) at x,y: `);
      const [x, y] = input.split(",").map((n) => parseInt(n.trim()));
      const unit = createUnit(`p-${pick.name}`, pick.name, pick.class, "player", { x: x || 0, y: y || 0 }, pick.prompt);
      const err = placeUnit(state, unit, unit.position);
      if (err) {
        unit.position = { x: playerUnits.indexOf(pick) * 2, y: 0 };
        placeUnit(state, unit, unit.position);
      }
      console.log(`  ✓ ${pick.name} → (${unit.position.x}, ${unit.position.y})`);
    }
  } else {
    console.log("Player placing units...");
    const pp = await getPlacement(playerUnits.map((u) => ({ name: u.name, class: u.class })), "player", playerPlacementPrompt);
    for (const p of pp.placements) {
      const pick = playerUnits.find((u) => u.name === p.name);
      if (!pick) continue;
      const unit = createUnit(`p-${pick.name}`, pick.name, pick.class, "player", p.position, pick.prompt);
      const err = placeUnit(state, unit, unit.position);
      if (err) {
        unit.position = { x: playerUnits.indexOf(pick) * 2, y: 0 };
        placeUnit(state, unit, unit.position);
      }
      console.log(`  ✓ ${pick.name} → (${unit.position.x}, ${unit.position.y})`);
    }
  }

  console.log("\nOpponent placing units...");
  const op = await getPlacement(opponentUnits.map((u) => ({ name: u.name, class: u.class })), "opponent", opponentPlacementPrompt);
  for (const p of op.placements) {
    const pick = opponentUnits.find((u) => u.name === p.name);
    if (!pick) continue;
    const unit = createUnit(`o-${pick.name}`, pick.name, pick.class, "opponent", p.position, pick.prompt);
    const err = placeUnit(state, unit, unit.position);
    if (err) {
      unit.position = { x: opponentUnits.indexOf(pick) * 2, y: 5 };
      placeUnit(state, unit, unit.position);
    }
    console.log(`  ✓ ${pick.name} → (${unit.position.x}, ${unit.position.y})`);
  }
}

// === Turn Execution ===

async function executeTurn(
  state: GameState,
  side: Side,
  lastTurnLog: string[],
  logger: GameLogger
): Promise<{ turnLog: string[]; actionSummary: string[] }> {
  const turnLog: string[] = [];
  const actionSummary: string[] = [];
  const units = getLivingUnits(state, side);
  const sideLabel = side === "player" ? "\x1b[36m" : "\x1b[31m";

  logger.startTurn(state.turn, side);

  emitTraining({
    type: "turn_start",
    turn: state.turn,
    side,
    units: TrainingRecorder.snapshotUnits(state) as any,
    traps: TrainingRecorder.snapshotTraps(state),
  });

  for (const unit of units) {
    if (unit.hp <= 0) continue;
    const ctx = buildGameContext(state, unit, lastTurnLog);

    process.stdout.write(`  ${sideLabel}${unit.name}\x1b[0m thinking...`);

    try {
      const t0 = Date.now();
      const response = await getUnitAction(ctx);
      const durationMs = Date.now() - t0;
      process.stdout.write(` \x1b[2m💭 ${response.thinking}\x1b[0m\n`);

      emitTraining({
        type: "agent_decision",
        unitId: unit.id,
        thinking: response.thinking,
        firstAction: actionToRecord(response.firstAction),
        secondAction: actionToRecord(response.secondAction),
        durationMs,
      });

      const actions: string[] = [];

      const err1 = executeAction(state, unit, response.firstAction);
      if (err1) {
        actions.push(`⚠ ${describeAction(response.firstAction)} FAILED: ${err1}`);
      } else {
        actions.push(describeAction(response.firstAction));
      }

      const err2 = executeAction(state, unit, response.secondAction);
      if (err2) {
        actions.push(`⚠ ${describeAction(response.secondAction)} FAILED: ${err2}`);
      } else {
        actions.push(describeAction(response.secondAction));
      }

      logger.logAction(unit, response.thinking, response.firstAction, err1, response.secondAction, err2);

      const summary = `${sideLabel}${unit.name}\x1b[0m: ${actions.join(" → ")}`;
      actionSummary.push(summary);
      turnLog.push(`${unit.name}: ${actions.join(" → ")}`);
    } catch (e: any) {
      process.stdout.write(` ⚠ error: ${e.message}\n`);
      logger.logError(unit, e.message);
      actionSummary.push(`${sideLabel}${unit.name}\x1b[0m: \x1b[31mAGENT ERROR — turn wasted\x1b[0m`);
      turnLog.push(`${unit.name}: agent error`);
    }
  }

  logger.endTurn(state);
  return { turnLog, actionSummary };
}

function actionToRecord(action: UnitAction): { type: string; ability?: string; target?: { x: number; y: number }; direction?: "N" | "S" | "E" | "W" } {
  switch (action.type) {
    case "move": return { type: "move", target: action.target };
    case "ability": return { type: "ability", ability: action.ability, target: action.target, direction: action.direction };
    case "wait": return { type: "wait" };
    default: return { type: "unknown" };
  }
}

function executeAction(state: GameState, unit: Unit, action: UnitAction): string | null {
  switch (action.type) {
    case "move": return moveUnit(state, unit, action.target);
    case "ability": return useAbility(state, unit, action.ability, action.target, action.direction, action.addendum);
    case "wait": return null;
    default: return "Unknown action";
  }
}

function describeAction(action: UnitAction): string {
  switch (action.type) {
    case "move": return `move → (${action.target.x},${action.target.y})`;
    case "ability": return `${action.ability}${action.target ? ` → (${action.target.x},${action.target.y})` : ""}${action.direction ? ` facing ${action.direction}` : ""}`;
    case "wait": return "wait";
    default: return "?";
  }
}

// === Main ===

async function main() {
  console.log("\x1b[1m\x1b[35m");
  console.log("  ╔═══════════════════════════╗");
  console.log("  ║        S I B Y L          ║");
  console.log("  ║   Prompt-Driven Tactics   ║");
  console.log("  ╚═══════════════════════════╝");
  console.log("\x1b[0m");

  const configPath = process.argv.filter((a) => a !== "--cli")[2];
  let playerUnits: UnitConfig[];
  let opponentUnits: UnitConfig[];
  let playerPlacementPrompt: string;
  let opponentPlacementPrompt: string;
  let interactive: boolean;

  if (configPath) {
    const config = loadConfig(configPath);
    playerUnits = config.player.units;
    opponentUnits = config.opponent.units;
    playerPlacementPrompt = config.player.placementPrompt;
    opponentPlacementPrompt = config.opponent.placementPrompt;
    interactive = false;
    console.log(`  Config: ${configPath}`);
    console.log(`  Agent:  ${USE_CLI ? "claude CLI (subscription)" : "API (credits)"}`);
    console.log(`  ${"\x1b[36m"}Player:${"\x1b[0m"}   ${playerUnits.map((u) => `${u.name} (${u.class})`).join(" · ")}`);
    console.log(`  ${"\x1b[31m"}Opponent:${"\x1b[0m"} ${opponentUnits.map((u) => `${u.name} (${u.class})`).join(" · ")}`);
  } else {
    playerUnits = await selectSquad();
    opponentUnits = [
      { name: "Guard", class: "sentinel", prompt: "Advance toward the nearest enemy. Use shield_wall facing the direction with the most enemies." },
      { name: "Sniper", class: "striker", prompt: "Stay at range. Use precision_shot on the lowest HP enemy. Retreat if enemies close in." },
      { name: "Field Doc", class: "medic", prompt: "Stay behind Guard. Patch the most injured ally. If all healthy, overclock Sniper." },
    ];
    playerPlacementPrompt = "Place units strategically.";
    opponentPlacementPrompt = "Place Guard center front. Sniper back. Field Doc behind Guard.";
    interactive = true;
  }

  const state = createGame();
  const logger = new GameLogger(USE_CLI ? "cli" : "api", configPath);
  logger.setSquad("player", playerUnits);
  logger.setSquad("opponent", opponentUnits);

  // Training data recorder
  const recorder = new TrainingRecorder(USE_CLI ? "cli" : "api", configPath);
  setTrainingListener((event) => recorder.record(event));

  await runPlacementPhase(state, playerUnits, playerPlacementPrompt, opponentUnits, opponentPlacementPrompt, interactive);

  startPlay(state);
  let lastPlayerLog: string[] = [];
  let lastOpponentLog: string[] = [];
  const MAX_TURNS = 20;

  // Show initial state
  console.log(renderFullState(state));

  while (state.phase === "play" && state.turn <= MAX_TURNS) {
    const side = state.activesSide;
    const label = side === "player" ? "\x1b[36m▶ PLAYER TURN\x1b[0m" : "\x1b[31m▶ ENEMY TURN\x1b[0m";
    console.log(`\n  \x1b[1m${label}\x1b[0m\n`);

    if (interactive && side === "player") {
      const edit = await ask("  Edit prompts? (y/N): ");
      if (edit.toLowerCase() === "y") {
        for (const unit of getLivingUnits(state, "player")) {
          console.log(`\n  \x1b[36m${unit.name}\x1b[0m: ${unit.prompt}`);
          const np = await ask("  New prompt (enter to keep): ");
          if (np) unit.prompt = np;
        }
      }
    }

    const { turnLog, actionSummary } = side === "player"
      ? await executeTurn(state, "player", lastOpponentLog, logger)
      : await executeTurn(state, "opponent", lastPlayerLog, logger);

    if (side === "player") lastPlayerLog = turnLog;
    else lastOpponentLog = turnLog;

    endTurn(state);

    // Render full state after both sides have gone, or after each side
    console.log(renderFullState(state, actionSummary));
  }

  if (state.turn > MAX_TURNS && state.phase === "play") {
    console.log("\n\x1b[1m⏰ DRAW — Max turns reached.\x1b[0m\n");
    logger.finish(state, "Max turns reached");
  } else {
    console.log(renderGameOver(state));
    logger.finish(state, state.winner ? `${state.winner} eliminated all enemies` : "unknown");
  }

  close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
