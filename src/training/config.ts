import { z } from "zod/v4";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const TrainingConfig = z.object({
  nextGameId: z.number(),
});

type TrainingConfig = z.infer<typeof TrainingConfig>;

const CONFIG_PATH = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../../training/config.json");

export function readTrainingConfig(): TrainingConfig {
  if (!existsSync(CONFIG_PATH)) {
    const defaults: TrainingConfig = { nextGameId: 0 };
    writeTrainingConfig(defaults);
    return defaults;
  }
  return TrainingConfig.parse(JSON.parse(readFileSync(CONFIG_PATH, "utf-8")));
}

export function writeTrainingConfig(cfg: TrainingConfig): void {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}
