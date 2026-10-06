import {
  createGame,
  createUnit,
  placeUnit,
  startPlay,
  moveUnit,
  useAbility,
  buildGameContext,
  getNextUnit,
  unitActed,
  cleanupAfterUnitActs,
  advanceRound,
  checkWinCondition,
} from "./engine/game";
import * as jevAgent from "./agent/jev-agent";
import { renderFullState, renderGameOver } from "./cli/renderer";

// Only initialize legacy clients when explicitly requested.
const USE_API = process.argv.includes("--api");
const USE_CLI = process.argv.includes("--cli");
if (USE_API && USE_CLI) throw Error("Choose only one of --api or --cli");
const USE_JEV = !USE_API && !USE_CLI;
const BACKEND = USE_JEV ? "jev" : USE_CLI ? "cli" : "api";
const legacyAgent = USE_CLI
  ? await import("./agent/cli-agent")
  : USE_API
    ? await import("./agent/agent")
    : undefined;
const getPlacement = legacyAgent?.getPlacement ?? jevAgent.getPlacement;
import { ask, askMultiline, close } from "./cli/input";
import { GameLogger } from "./logger";
import { BALANCE } from "./types";
import { TrainingRecorder } from "./training/recorder";
import { setTrainingListener, emit as emitTraining } from "./training/emitter";
import { generateRandomConfig } from "./training/squads";
import type { GameState, UnitClass, Unit, UnitAction, UnitConfig, GameConfig } from "./types";
import { readFileSync } from "fs";

const CLASSES: UnitClass[] = ["sentinel", "specter", "oracle", "striker", "medic", "vector"];

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
    const cls = idx >= 0 && idx < CLASSES.length ? CLASSES[idx]! : ("sentinel" as UnitClass);
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
  interactive: boolean,
): Promise<void> {
  console.log("\n\x1b[1m═══ PLACEMENT PHASE ═══\x1b[0m\n");

  if (interactive) {
    console.log("Place your units in rows 0-1 (bottom). Grid: x 0-5.\n");
    for (const pick of playerUnits) {
      const input = await ask(`Place ${pick.name} (${pick.class}) at x,y: `);
      const [x, y] = input.split(",").map((n) => parseInt(n.trim()));
      const unit = createUnit(
        `p-${pick.name}`,
        pick.name,
        pick.class,
        "player",
        { x: x || 0, y: y || 0 },
        pick.prompt,
      );
      const err = placeUnit(state, unit, unit.position);
      if (err) {
        unit.position = { x: playerUnits.indexOf(pick) * 2, y: 0 };
        placeUnit(state, unit, unit.position);
      }
      console.log(`  ✓ ${pick.name} → (${unit.position.x}, ${unit.position.y})`);
    }
  } else {
    console.log("Player placing units...");
    const pp = await getPlacement(
      playerUnits.map((u) => ({ name: u.name, class: u.class })),
      "player",
      playerPlacementPrompt,
    );
    // Fallback to default positions if placement parse failed
    const playerPlacements =
      pp.placements.length > 0
        ? pp.placements
        : playerUnits.map((u, i) => ({ name: u.name, position: { x: i * 2, y: 0 } }));
    if (pp.placements.length === 0) {
      console.log("  ⚠ Placement parse failed, using fallback positions");
    }
    const placedPlayerNames = new Set<string>();
    for (const p of playerPlacements) {
      const pick = playerUnits.find((u) => u.name.toLowerCase() === p.name?.toLowerCase());
      if (!pick) {
        console.error(`  ⚠ Placement name "${p.name}" doesn't match any player unit, skipping`);
        continue;
      }
      placedPlayerNames.add(pick.name);
      const unit = createUnit(
        `p-${pick.name}`,
        pick.name,
        pick.class,
        "player",
        p.position,
        pick.prompt,
      );
      const err = placeUnit(state, unit, unit.position);
      if (err) {
        unit.position = { x: playerUnits.indexOf(pick) * 2, y: 0 };
        placeUnit(state, unit, unit.position);
      }
      console.log(`  ✓ ${pick.name} → (${unit.position.x}, ${unit.position.y})`);
    }
    // Fallback: place any unmatched units at default positions
    for (const pick of playerUnits) {
      if (placedPlayerNames.has(pick.name)) continue;
      console.error(`  ⚠ ${pick.name} was not placed by agent, using fallback position`);
      const unit = createUnit(
        `p-${pick.name}`,
        pick.name,
        pick.class,
        "player",
        { x: playerUnits.indexOf(pick) * 2, y: 0 },
        pick.prompt,
      );
      placeUnit(state, unit, unit.position);
      console.log(`  ✓ ${pick.name} → (${unit.position.x}, ${unit.position.y}) [fallback]`);
    }
  }

  console.log("\nOpponent placing units...");
  const op = await getPlacement(
    opponentUnits.map((u) => ({ name: u.name, class: u.class })),
    "opponent",
    opponentPlacementPrompt,
  );
  // Fallback to default positions if placement parse failed
  const opponentPlacements =
    op.placements.length > 0
      ? op.placements
      : opponentUnits.map((u, i) => ({ name: u.name, position: { x: i * 2, y: 5 } }));
  if (op.placements.length === 0) {
    console.log("  ⚠ Placement parse failed, using fallback positions");
  }
  const placedOpponentNames = new Set<string>();
  for (const p of opponentPlacements) {
    const pick = opponentUnits.find((u) => u.name.toLowerCase() === p.name?.toLowerCase());
    if (!pick) {
      console.error(`  ⚠ Placement name "${p.name}" doesn't match any opponent unit, skipping`);
      continue;
    }
    placedOpponentNames.add(pick.name);
    const unit = createUnit(
      `o-${pick.name}`,
      pick.name,
      pick.class,
      "opponent",
      p.position,
      pick.prompt,
    );
    const err = placeUnit(state, unit, unit.position);
    if (err) {
      unit.position = { x: opponentUnits.indexOf(pick) * 2, y: 5 };
      placeUnit(state, unit, unit.position);
    }
    console.log(`  ✓ ${pick.name} → (${unit.position.x}, ${unit.position.y})`);
  }
  // Fallback: place any unmatched units at default positions
  for (const pick of opponentUnits) {
    if (placedOpponentNames.has(pick.name)) continue;
    console.error(`  ⚠ ${pick.name} was not placed by agent, using fallback position`);
    const unit = createUnit(
      `o-${pick.name}`,
      pick.name,
      pick.class,
      "opponent",
      { x: opponentUnits.indexOf(pick) * 2, y: 5 },
      pick.prompt,
    );
    placeUnit(state, unit, unit.position);
    console.log(`  ✓ ${pick.name} → (${unit.position.x}, ${unit.position.y}) [fallback]`);
  }
}

// === Action Helpers ===

function actionToRecord(action: UnitAction): {
  type: string;
  ability?: string;
  target?: { x: number; y: number };
  direction?: "N" | "S" | "E" | "W";
} {
  switch (action.type) {
    case "move":
      return { type: "move", target: action.target };
    case "ability":
      return {
        type: "ability",
        ability: action.ability,
        target: action.target,
        direction: action.direction,
      };
    case "wait":
      return { type: "wait" };
    default:
      return { type: "unknown" };
  }
}

function executeAction(state: GameState, unit: Unit, action: UnitAction): string | null {
  switch (action.type) {
    case "move":
      return moveUnit(state, unit, action.target);
    case "ability":
      return useAbility(
        state,
        unit,
        action.ability,
        action.target,
        action.direction,
        action.addendum,
      );
    case "wait":
      return null;
    default:
      return "Unknown action";
  }
}

function describeAction(action: UnitAction): string {
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

// === Execute Single Unit Turn ===

async function executeUnitTurn(
  state: GameState,
  unit: Unit,
  lastRoundLog: string[],
  logger: GameLogger,
): Promise<{ actionLog: string; actionSummary: string }> {
  const ctx = buildGameContext(state, unit, lastRoundLog);
  const sideLabel = unit.side === "player" ? "\x1b[36m" : "\x1b[31m";

  process.stdout.write(
    `  ${sideLabel}${unit.name}\x1b[0m \x1b[2m(${unit.class} spd:${unit.speed})\x1b[0m thinking...`,
  );

  try {
    const t0 = Date.now();
    const response = USE_JEV
      ? await jevAgent.executeJevTurn(state, unit, lastRoundLog)
      : await legacyAgent!.getUnitAction(ctx);
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

    const err1 = USE_JEV ? null : executeAction(state, unit, response.firstAction);
    if (err1) {
      actions.push(`⚠ ${describeAction(response.firstAction)} FAILED: ${err1}`);
    } else {
      actions.push(describeAction(response.firstAction));
    }

    const err2 = USE_JEV ? null : executeAction(state, unit, response.secondAction);
    if (err2) {
      actions.push(`⚠ ${describeAction(response.secondAction)} FAILED: ${err2}`);
    } else {
      actions.push(describeAction(response.secondAction));
    }

    logger.logAction(
      unit,
      response.thinking,
      response.firstAction,
      err1,
      response.secondAction,
      err2,
    );

    const summary = `${sideLabel}${unit.name}\x1b[0m: ${actions.join(" → ")}`;
    const log = `${unit.name}: ${actions.join(" → ")}`;
    return { actionLog: log, actionSummary: summary };
  } catch (e: any) {
    process.stdout.write(` ⚠ error: ${e.message}\n`);
    logger.logError(unit, e.message);
    return {
      actionLog: `${unit.name}: agent error`,
      actionSummary: `${sideLabel}${unit.name}\x1b[0m: \x1b[31mAGENT ERROR — see log (earlier actions may have resolved)\x1b[0m`,
    };
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

  const AUTO = process.argv.includes("--auto");

  // --grid WxH to override map size (e.g. --grid 8x8)
  const gridArg = process.argv.find((a) => a.startsWith("--grid=") || a === "--grid");
  if (gridArg) {
    const val = gridArg.includes("=")
      ? gridArg.split("=")[1]
      : process.argv[process.argv.indexOf(gridArg) + 1];
    const match = val?.match(/^(\d+)x(\d+)$/i);
    if (!match) {
      console.error("  Invalid --grid format. Use WxH, e.g. --grid 8x8");
      process.exit(1);
    }
    BALANCE.grid.width = parseInt(match[1]!);
    BALANCE.grid.height = parseInt(match[2]!);
    console.log(`  Grid override: ${BALANCE.grid.width}x${BALANCE.grid.height}`);
  }

  const configPath = process.argv.filter((a) => !a.startsWith("--"))[2];
  let gameConfig: GameConfig;
  let interactive: boolean;

  if (configPath) {
    gameConfig = loadConfig(configPath);
    interactive = false;
    console.log(`  Config: ${configPath}`);
    console.log(
      `  Agent:  ${USE_JEV ? "Jev (TypeSafe)" : USE_CLI ? "claude CLI (subscription)" : "Anthropic API (credits)"}`,
    );
    console.log(
      `  ${"\x1b[36m"}Player:${"\x1b[0m"}   ${gameConfig.player.units.map((u) => `${u.name} (${u.class})`).join(" · ")}`,
    );
    console.log(
      `  ${"\x1b[31m"}Opponent:${"\x1b[0m"} ${gameConfig.opponent.units.map((u) => `${u.name} (${u.class})`).join(" · ")}`,
    );
  } else if ((USE_CLI || USE_JEV) && !AUTO) {
    const playerUnits = await selectSquad();
    const opponentUnits: UnitConfig[] = [
      {
        name: "Guard",
        class: "sentinel",
        prompt:
          "Advance toward the nearest enemy. Use shield_wall facing the direction with the most enemies.",
      },
      {
        name: "Sniper",
        class: "striker",
        prompt:
          "Stay at range. Use precision_shot on the lowest HP enemy. Retreat if enemies close in.",
      },
      {
        name: "Field Doc",
        class: "medic",
        prompt: "Stay behind Guard. Patch the most injured ally. If all healthy, overclock Sniper.",
      },
    ];
    gameConfig = {
      player: { units: playerUnits, placementPrompt: "Place units strategically." },
      opponent: {
        units: opponentUnits,
        placementPrompt: "Place Guard center front. Sniper back. Field Doc behind Guard.",
      },
    };
    interactive = true;
  } else {
    gameConfig = generateRandomConfig();
    interactive = false;
    console.log("  Config: random squad generation");
    console.log(
      `  Agent:  ${USE_JEV ? "Jev (TypeSafe)" : USE_CLI ? "claude CLI (subscription)" : "Anthropic API (credits)"}`,
    );
    console.log(
      `  ${"\x1b[36m"}Player:${"\x1b[0m"}   ${gameConfig.player.units.map((u) => `${u.name} (${u.class})`).join(" · ")}`,
    );
    console.log(
      `  ${"\x1b[31m"}Opponent:${"\x1b[0m"} ${gameConfig.opponent.units.map((u) => `${u.name} (${u.class})`).join(" · ")}`,
    );
  }

  const playerUnits = gameConfig.player.units;
  const opponentUnits = gameConfig.opponent.units;
  const playerPlacementPrompt = gameConfig.player.placementPrompt;
  const opponentPlacementPrompt = gameConfig.opponent.placementPrompt;

  const state = createGame();
  const logger = new GameLogger(BACKEND, configPath);
  logger.setSquad("player", playerUnits);
  logger.setSquad("opponent", opponentUnits);

  // Training data recorder
  const model = USE_JEV
    ? jevAgent.JEV_MODEL
    : USE_CLI
      ? "sonnet (CLI alias; resolved model unavailable)"
      : "claude-sonnet-4-20250514";
  const recorder = new TrainingRecorder(BACKEND, gameConfig, model);
  setTrainingListener((event) => recorder.record(event));

  // Record full game config at start
  emitTraining({
    type: "game_config",
    player: { units: playerUnits, placementPrompt: playerPlacementPrompt },
    opponent: { units: opponentUnits, placementPrompt: opponentPlacementPrompt },
    agent: BACKEND,
    configFile: configPath,
  });

  await runPlacementPhase(
    state,
    playerUnits,
    playerPlacementPrompt,
    opponentUnits,
    opponentPlacementPrompt,
    interactive,
  );

  startPlay(state);
  let lastRoundLog: string[] = [];
  const MAX_ROUNDS = BALANCE.maxRounds;

  // Show initial state
  console.log(renderFullState(state));

  // === Per-Unit Turn Loop ===
  while (state.phase === "play" && state.round <= MAX_ROUNDS) {
    console.log(`\n  \x1b[1m\x1b[35m═══ ROUND ${state.round} ═══\x1b[0m`);

    // Show turn order
    const orderStr = state.turnStack
      .map((id) => {
        const u = state.units.find((u) => u.id === id);
        if (!u || u.hp <= 0) return null;
        const color = u.side === "player" ? "\x1b[36m" : "\x1b[31m";
        return `${color}${u.name}\x1b[0m\x1b[2m(${u.speed})\x1b[0m`;
      })
      .filter(Boolean)
      .join(" → ");
    console.log(`  \x1b[2mOrder:\x1b[0m ${orderStr}\n`);

    logger.startTurn(state.round, "player"); // compat

    emitTraining({
      type: "turn_start",
      turn: state.round,
      side: "player", // legacy compat
      units: TrainingRecorder.snapshotUnits(state) as any,
      traps: TrainingRecorder.snapshotTraps(state),
      turnStack: [...state.turnStack],
    });

    const roundActions: string[] = [];
    const roundLog: string[] = [];

    // Process each unit in speed order
    let unit = getNextUnit(state);
    while (unit) {
      if (interactive && unit.side === "player") {
        console.log(`\n  \x1b[36m${unit.name}\x1b[0m: ${unit.prompt}`);
        const np = await ask("  New prompt (enter to keep): ");
        if (np) unit.prompt = np;
      }

      const { actionLog, actionSummary } = await executeUnitTurn(state, unit, lastRoundLog, logger);

      roundActions.push(actionSummary);
      roundLog.push(actionLog);

      // Cleanup this unit's temporary effects
      cleanupAfterUnitActs(state, unit);

      // Mark as acted
      unitActed(state);

      // Check for win condition after each unit acts (someone might have died)
      if (checkWinCondition(state)) break;

      // Get next unit
      unit = getNextUnit(state);
    }

    if ((state as GameState).phase === "ended") break;

    logger.endTurn(state);
    lastRoundLog = roundLog;

    // Show state after each round
    console.log(renderFullState(state, roundActions));

    // Advance to next round
    if (!advanceRound(state)) break;
  }

  if (state.round > MAX_ROUNDS && state.phase === "play") {
    console.log("\n\x1b[1m⏰ DRAW — Max rounds reached.\x1b[0m\n");
    logger.finish(state, "Max rounds reached");
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
