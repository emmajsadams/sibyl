import { writeFileSync, mkdirSync } from "fs";
import { readFileSync } from "fs";
import { join } from "path";
import type { TrainingEvent, TrainingFile } from "./schema";
import type { GameState, Unit } from "../types";
import { readTrainingConfig, writeTrainingConfig } from "./config";

const PKG_PATH = join(import.meta.dir, "../../package.json");

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf-8"));
}

// Read version from package.json at import time
export const GAME_VERSION: string = readJson(PKG_PATH).version;

export class TrainingRecorder {
  private data: TrainingFile;
  private filePath: string;

  constructor(agent: string, config?: string) {
    const version: string = readJson(PKG_PATH).version;
    const cfg = readTrainingConfig();
    const nextGameId = cfg.nextGameId;
    const gameId = `v${version}-${nextGameId}`;

    mkdirSync("training", { recursive: true });
    this.filePath = join("training", `training-${gameId}.json`);

    // Increment the counter and write back
    writeTrainingConfig({ nextGameId: nextGameId + 1 });

    this.data = {
      version: GAME_VERSION,
      gameId,
      timestamp: new Date().toISOString(),
      agent,
      config,
      events: [],
    };

    this.flush();
  }

  /** Record an event and immediately write to disk */
  record(event: TrainingEvent): void {
    this.data.events.push(event);
    this.flush();
  }

  /** Snapshot all units into the format the schema expects */
  static snapshotUnits(state: GameState): any[] {
    return state.units.map((u) => ({
      id: u.id,
      name: u.name,
      class: u.class,
      side: u.side,
      hp: u.hp,
      maxHp: u.maxHp,
      speed: u.speed,
      position: { ...u.position },
      facing: u.facing,
      statusEffects: u.statusEffects.map((e) => ({ ...e })),
      prompt: u.prompt,
      breachAddendum: u.breachAddendum,
      movedThisTurn: u.movedThisTurn,
      healsUsed: u.healsUsed,
    }));
  }

  static snapshotTraps(state: GameState) {
    return state.traps.map((t) => ({
      position: { ...t.position },
      owner: t.owner,
      side: t.side,
    }));
  }

  static snapshotUnit(u: Unit) {
    return {
      id: u.id,
      name: u.name,
      class: u.class,
      side: u.side,
      hp: u.hp,
      maxHp: u.maxHp,
      speed: u.speed,
      position: { ...u.position },
      facing: u.facing,
      statusEffects: u.statusEffects.map((e) => ({ ...e })),
      prompt: u.prompt,
      breachAddendum: u.breachAddendum,
      movedThisTurn: u.movedThisTurn,
      healsUsed: u.healsUsed,
    };
  }

  get path(): string {
    return this.filePath;
  }

  private flush(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }
}
