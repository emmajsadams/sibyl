import { test, expect } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GameLogger } from "./logger";
import { createGame, createUnit, advanceRound, startPlay } from "./engine/game";
import { BALANCE } from "./types";

function fixture() {
  const state = createGame();
  state.units = [
    createUnit("p", "P", "sentinel", "player", { x: 0, y: 0 }, "wait"),
    createUnit("o", "O", "sentinel", "opponent", { x: 5, y: 5 }, "wait"),
  ];
  startPlay(state);
  return state;
}
function logged(run: (logger: GameLogger) => void) {
  const cwd = process.cwd();
  const dir = mkdtempSync(join(tmpdir(), "sibyl-log-test-"));
  try {
    process.chdir(dir);
    run(new GameLogger("jev"));
    return JSON.parse(
      readFileSync(
        join(dir, "runs", readdirSync("runs").find((p) => p.endsWith(".json"))!),
        "utf8",
      ),
    );
  } finally {
    process.chdir(cwd);
    rmSync(dir, { recursive: true, force: true });
  }
}
test("real engine max-round draw retains terminal reason in recording", () => {
  const state = fixture();
  state.round = BALANCE.maxRounds;
  advanceRound(state);
  expect(state.phase).toBe("ended");
  const log = logged((logger) => logger.finish(state, "unknown"));
  expect(log.result.reason).toBe("Stalemate after 20 rounds — draw (6 HP each)");
});
test("failed decision on final pending turn excludes game from CLEAN", () => {
  const state = fixture();
  state.round = BALANCE.maxRounds;
  advanceRound(state);
  const log = logged((logger) => {
    logger.startTurn(state.round, "player");
    logger.logError(state.units[0]!, "provider failure");
    logger.finish(state, "unknown");
  });
  expect(log.turns).toHaveLength(1);
  expect(log.result.clean).toBe(false);
  expect(log.result.failedDecisions).toBe(1);
});
