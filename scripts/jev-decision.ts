/** One live decision, no game loop, placement phase, training files or state mutation. */
import { createGame, createUnit } from "../src/engine/game";
import { decideAction } from "../src/agent/jev-agent";

const state = createGame();
const unit = createUnit(
  "probe",
  "Probe",
  "striker",
  "player",
  { x: 1, y: 1 },
  "Use precision_shot on the visible enemy. Do not attack allies.",
);
state.units = [
  unit,
  createUnit("enemy", "Enemy", "medic", "opponent", { x: 3, y: 1 }, "Heal allies."),
];
const before = JSON.stringify(state);
const result = await decideAction(state, unit);
if (JSON.stringify(state) !== before) throw Error("Decision mutated the engine state");
console.log(JSON.stringify(result, null, 2));
