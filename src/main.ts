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
import { getUnitAction, getPlacement } from "./agent/agent";
import { renderTurn, renderGrid, renderUnitStatus } from "./cli/renderer";
import { ask, askMultiline, close } from "./cli/input";
import type { GameState, UnitClass, Side, Unit, UnitAction } from "./types";
import { readFileSync } from "fs";

const CLASSES: UnitClass[] = [
  "sentinel",
  "specter",
  "oracle",
  "striker",
  "medic",
  "vector",
];

// === Config Loading ===

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
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

// === Interactive Squad Selection ===

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
    console.log("Place your units in rows 0-1 (bottom two rows). Grid is 6 wide (x: 0-5).\n");
    for (const pick of playerUnits) {
      const input = await ask(`Place ${pick.name} (${pick.class}) at x,y: `);
      const [x, y] = input.split(",").map((n) => parseInt(n.trim()));
      const unit = createUnit(
        `p-${pick.name}`, pick.name, pick.class, "player",
        { x: x || 0, y: y || 0 }, pick.prompt
      );
      const err = placeUnit(state, unit, unit.position);
      if (err) {
        console.log(`  ⚠ ${err} — placing at default`);
        unit.position = { x: playerUnits.indexOf(pick) * 2, y: 0 };
        placeUnit(state, unit, unit.position);
      }
      console.log(`  ✓ ${pick.name} placed at (${unit.position.x}, ${unit.position.y})`);
    }
  } else {
    // AI-driven placement for player too
    console.log("Player placing units...");
    const playerPlacement = await getPlacement(
      playerUnits.map((u) => ({ name: u.name, class: u.class })),
      "player",
      playerPlacementPrompt
    );
    for (const p of playerPlacement.placements) {
      const pick = playerUnits.find((u) => u.name === p.name);
      if (!pick) continue;
      const unit = createUnit(
        `p-${pick.name}`, pick.name, pick.class, "player", p.position, pick.prompt
      );
      const err = placeUnit(state, unit, unit.position);
      if (err) {
        unit.position = { x: playerUnits.indexOf(pick) * 2, y: 0 };
        placeUnit(state, unit, unit.position);
      }
      console.log(`  ✓ ${pick.name} placed at (${unit.position.x}, ${unit.position.y})`);
    }
  }

  // Opponent placement (always AI)
  console.log("\nOpponent placing units...");
  const oppPlacement = await getPlacement(
    opponentUnits.map((u) => ({ name: u.name, class: u.class })),
    "opponent",
    opponentPlacementPrompt
  );
  for (const p of oppPlacement.placements) {
    const pick = opponentUnits.find((u) => u.name === p.name);
    if (!pick) continue;
    const unit = createUnit(
      `o-${pick.name}`, pick.name, pick.class, "opponent", p.position, pick.prompt
    );
    const err = placeUnit(state, unit, unit.position);
    if (err) {
      unit.position = { x: opponentUnits.indexOf(pick) * 2, y: 5 };
      placeUnit(state, unit, unit.position);
    }
    console.log(`  ✓ ${pick.name} placed at (${unit.position.x}, ${unit.position.y})`);
  }
}

// === Turn Execution ===

async function executeTurn(
  state: GameState,
  side: Side,
  lastTurnLog: string[]
): Promise<string[]> {
  const turnLog: string[] = [];
  const units = getLivingUnits(state, side);

  for (const unit of units) {
    if (unit.hp <= 0) continue; // may have died mid-turn
    const ctx = buildGameContext(state, unit, lastTurnLog);

    console.log(`\n  \x1b[2m${unit.name} (${unit.class}) thinking...\x1b[0m`);

    try {
      const response = await getUnitAction(ctx);
      console.log(`  \x1b[2m💭 ${response.thinking}\x1b[0m`);

      const err1 = executeAction(state, unit, response.firstAction);
      if (err1) {
        console.log(`  ⚠ First action failed: ${err1}`);
        turnLog.push(`${unit.name}: first action failed (${err1})`);
      }

      const err2 = executeAction(state, unit, response.secondAction);
      if (err2) {
        console.log(`  ⚠ Second action failed: ${err2}`);
        turnLog.push(`${unit.name}: second action failed (${err2})`);
      }

      turnLog.push(
        `${unit.name}: ${describeAction(response.firstAction)} then ${describeAction(response.secondAction)}`
      );
    } catch (e: any) {
      console.log(`  ⚠ Agent error: ${e.message}`);
      turnLog.push(`${unit.name}: agent error, wasted turn`);
    }
  }

  return turnLog;
}

function executeAction(state: GameState, unit: Unit, action: UnitAction): string | null {
  switch (action.type) {
    case "move":
      return moveUnit(state, unit, action.target);
    case "ability":
      return useAbility(state, unit, action.ability, action.target, action.direction, action.addendum);
    case "wait":
      return null;
    default:
      return "Unknown action type";
  }
}

function describeAction(action: UnitAction): string {
  switch (action.type) {
    case "move":
      return `moved to (${action.target.x}, ${action.target.y})`;
    case "ability":
      return `used ${action.ability}${action.target ? ` at (${action.target.x}, ${action.target.y})` : ""}`;
    case "wait":
      return "waited";
    default:
      return "unknown";
  }
}

// === Main ===

async function main() {
  console.log("\x1b[1m");
  console.log("  ╔═══════════════════════╗");
  console.log("  ║       S I B Y L       ║");
  console.log("  ║  Prompt-Driven Tactics ║");
  console.log("  ╚═══════════════════════╝");
  console.log("\x1b[0m");

  const configPath = process.argv[2];
  let playerUnits: UnitConfig[];
  let opponentUnits: UnitConfig[];
  let playerPlacementPrompt: string;
  let opponentPlacementPrompt: string;
  let interactive: boolean;

  if (configPath) {
    console.log(`Loading config from ${configPath}...`);
    const config = loadConfig(configPath);
    playerUnits = config.player.units;
    opponentUnits = config.opponent.units;
    playerPlacementPrompt = config.player.placementPrompt;
    opponentPlacementPrompt = config.opponent.placementPrompt;
    interactive = false;

    console.log(`\nPlayer squad: ${playerUnits.map((u) => `${u.name} (${u.class})`).join(", ")}`);
    console.log(`Opponent squad: ${opponentUnits.map((u) => `${u.name} (${u.class})`).join(", ")}`);
  } else {
    playerUnits = await selectSquad();
    opponentUnits = [
      { name: "Guard", class: "sentinel", prompt: "Advance toward the nearest enemy. Use shield_wall facing the direction with the most enemies. Protect allies when possible." },
      { name: "Sniper", class: "striker", prompt: "Stay at range. Use precision_shot on the lowest HP enemy. If enemies are close, retreat first. Never move into melee range." },
      { name: "Field Doc", class: "medic", prompt: "Stay behind Guard. Patch the most injured ally. If everyone is healthy, use overclock on Sniper." },
    ];
    playerPlacementPrompt = "Place units strategically.";
    opponentPlacementPrompt = "Place Guard in center front. Sniper in back with clear sight lines. Field Doc behind Guard for safety.";
    interactive = true;

    console.log(`\nOpponent squad: ${opponentUnits.map((u) => `${u.name} (${u.class})`).join(", ")}`);
  }

  const state = createGame();

  await runPlacementPhase(
    state, playerUnits, playerPlacementPrompt,
    opponentUnits, opponentPlacementPrompt, interactive
  );

  startPlay(state);
  let lastPlayerLog: string[] = [];
  let lastOpponentLog: string[] = [];

  const MAX_TURNS = 20; // safety valve

  while (state.phase === "play" && state.turn <= MAX_TURNS) {
    console.log(renderTurn(state));

    if (state.activesSide === "player") {
      if (interactive) {
        const edit = await ask("\nEdit prompts? (y/N): ");
        if (edit.toLowerCase() === "y") {
          for (const unit of getLivingUnits(state, "player")) {
            console.log(`\n\x1b[36m${unit.name}\x1b[0m current prompt:\n  ${unit.prompt}`);
            const newPrompt = await ask("New prompt (enter to keep): ");
            if (newPrompt) unit.prompt = newPrompt;
          }
        }
      }

      console.log("\n\x1b[1mYour units act:\x1b[0m");
      lastPlayerLog = await executeTurn(state, "player", lastOpponentLog);
    } else {
      console.log("\n\x1b[1mEnemy units act:\x1b[0m");
      lastOpponentLog = await executeTurn(state, "opponent", lastPlayerLog);
    }

    endTurn(state);
  }

  if (state.turn > MAX_TURNS && state.phase === "play") {
    console.log("\n\x1b[1m⏰ DRAW — Max turns reached.\x1b[0m\n");
  } else {
    console.log(renderTurn(state));
    console.log(
      `\n\x1b[1m${state.winner === "player" ? "🏆 VICTORY!" : "💀 DEFEAT."}\x1b[0m\n`
    );
  }

  close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
