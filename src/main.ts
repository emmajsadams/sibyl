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

const CLASSES: UnitClass[] = [
  "sentinel",
  "specter",
  "oracle",
  "striker",
  "medic",
  "vector",
];

async function selectSquad(): Promise<
  { name: string; class: UnitClass }[]
> {
  console.log("\n\x1b[1m═══ SIBYL — SQUAD SELECTION ═══\x1b[0m\n");
  console.log("Available units:");
  CLASSES.forEach((c, i) => console.log(`  ${i + 1}. ${c.toUpperCase()}`));
  console.log();

  const picks: { name: string; class: UnitClass }[] = [];
  for (let i = 0; i < 3; i++) {
    const input = await ask(`Pick unit ${i + 1} (1-6): `);
    const idx = parseInt(input) - 1;
    if (idx < 0 || idx >= CLASSES.length) {
      console.log("Invalid pick, defaulting to sentinel");
      picks.push({ name: `Unit-${i + 1}`, class: "sentinel" });
    } else {
      const name = await ask(`Name for your ${CLASSES[idx]}: `);
      picks.push({ name: name || `${CLASSES[idx]}-${i + 1}`, class: CLASSES[idx]! });
    }
  }
  return picks;
}

async function writePrompts(
  squad: { name: string; class: UnitClass }[]
): Promise<Map<string, string>> {
  console.log("\n\x1b[1m═══ WRITE YOUR PROMPTS ═══\x1b[0m");
  console.log(
    "Write instructions for each unit. These prompts will guide their AI.\n"
  );

  const prompts = new Map<string, string>();
  for (const unit of squad) {
    console.log(
      `\x1b[36m${unit.name}\x1b[0m (${unit.class.toUpperCase()}):`
    );
    const prompt = await askMultiline("> ");
    prompts.set(unit.name, prompt);
    console.log();
  }
  return prompts;
}

function generateOpponentSquad(): {
  squad: { name: string; class: UnitClass }[];
  prompts: Map<string, string>;
} {
  // Starter opponent — simple comp with basic prompts
  const squad = [
    { name: "Guard", class: "sentinel" as UnitClass },
    { name: "Sniper", class: "striker" as UnitClass },
    { name: "Field Doc", class: "medic" as UnitClass },
  ];

  const prompts = new Map<string, string>();
  prompts.set(
    "Guard",
    "Advance toward the nearest enemy. Use shield_wall facing the direction with the most enemies. Protect allies when possible."
  );
  prompts.set(
    "Sniper",
    "Stay at range. Use precision_shot on the lowest HP enemy. If enemies are close, retreat first. Never move into melee range."
  );
  prompts.set(
    "Field Doc",
    "Stay behind Guard. Patch the most injured ally. If everyone is healthy, use overclock on Sniper."
  );

  return { squad, prompts };
}

async function runPlacementPhase(
  state: GameState,
  playerSquad: { name: string; class: UnitClass }[],
  playerPrompts: Map<string, string>,
  opponentSquad: { name: string; class: UnitClass }[],
  opponentPrompts: Map<string, string>
): Promise<void> {
  console.log("\n\x1b[1m═══ PLACEMENT PHASE ═══\x1b[0m\n");

  // Player placement
  console.log("Place your units in rows 0-1 (bottom two rows).");
  console.log("Grid is 6 wide (x: 0-5).\n");

  for (const pick of playerSquad) {
    const input = await ask(
      `Place ${pick.name} (${pick.class}) at x,y: `
    );
    const [x, y] = input.split(",").map((n) => parseInt(n.trim()));
    const unit = createUnit(
      `p-${pick.name}`,
      pick.name,
      pick.class,
      "player",
      { x: x || 0, y: y || 0 },
      playerPrompts.get(pick.name) || ""
    );
    const err = placeUnit(state, unit, unit.position);
    if (err) {
      console.log(`  ⚠ ${err} — placing at default`);
      unit.position = { x: playerSquad.indexOf(pick) * 2, y: 0 };
      placeUnit(state, unit, unit.position);
    }
    console.log(
      `  ✓ ${pick.name} placed at (${unit.position.x}, ${unit.position.y})`
    );
  }

  // Opponent placement (AI-driven)
  console.log("\nOpponent placing units...");
  const oppPlacement = await getPlacement(
    opponentSquad,
    "opponent",
    "Place your units strategically. Spread out to avoid area damage. Keep the medic behind the front line."
  );

  for (const p of oppPlacement.placements) {
    const pick = opponentSquad.find((u) => u.name === p.name);
    if (!pick) continue;
    const unit = createUnit(
      `o-${pick.name}`,
      pick.name,
      pick.class,
      "opponent",
      p.position,
      opponentPrompts.get(pick.name) || ""
    );
    const err = placeUnit(state, unit, unit.position);
    if (err) {
      // Fallback placement
      unit.position = {
        x: opponentSquad.indexOf(pick) * 2,
        y: 5,
      };
      placeUnit(state, unit, unit.position);
    }
    console.log(
      `  ✓ ${pick.name} placed at (${unit.position.x}, ${unit.position.y})`
    );
  }
}

async function executeTurn(
  state: GameState,
  side: Side,
  lastTurnLog: string[]
): Promise<string[]> {
  const turnLog: string[] = [];
  const units = getLivingUnits(state, side);

  for (const unit of units) {
    const ctx = buildGameContext(state, unit, lastTurnLog);

    console.log(
      `\n  \x1b[2m${unit.name} (${unit.class}) thinking...\x1b[0m`
    );

    try {
      const response = await getUnitAction(ctx);
      console.log(`  \x1b[2m💭 ${response.thinking}\x1b[0m`);

      // Execute first action
      const err1 = executeAction(state, unit, response.firstAction);
      if (err1) {
        console.log(`  ⚠ First action failed: ${err1}`);
        turnLog.push(`${unit.name}: first action failed (${err1})`);
      }

      // Execute second action
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

function executeAction(
  state: GameState,
  unit: Unit,
  action: UnitAction
): string | null {
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
        action.addendum
      );
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

  // Squad selection
  const playerSquad = await selectSquad();
  const playerPrompts = await writePrompts(playerSquad);

  // Opponent
  const { squad: opponentSquad, prompts: opponentPrompts } =
    generateOpponentSquad();
  console.log(
    `\nOpponent squad: ${opponentSquad.map((u) => u.name + " (" + u.class + ")").join(", ")}`
  );

  // Game setup
  const state = createGame();

  // Placement
  await runPlacementPhase(
    state,
    playerSquad,
    playerPrompts,
    opponentSquad,
    opponentPrompts
  );

  // Begin
  startPlay(state);
  let lastPlayerLog: string[] = [];
  let lastOpponentLog: string[] = [];

  // Game loop
  while (state.phase === "play") {
    console.log(renderTurn(state));

    if (state.activesSide === "player") {
      // Allow prompt editing
      const edit = await ask(
        "\nEdit prompts? (y/N): "
      );
      if (edit.toLowerCase() === "y") {
        for (const unit of getLivingUnits(state, "player")) {
          console.log(
            `\n\x1b[36m${unit.name}\x1b[0m current prompt:\n  ${unit.prompt}`
          );
          const newPrompt = await ask("New prompt (enter to keep): ");
          if (newPrompt) unit.prompt = newPrompt;
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

  // Game over
  console.log(renderTurn(state));
  console.log(
    `\n\x1b[1m${state.winner === "player" ? "🏆 VICTORY!" : "💀 DEFEAT."}\x1b[0m\n`
  );
  close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
