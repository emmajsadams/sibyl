#!/usr/bin/env npx tsx
/**
 * Convert SIBYL training data → SFT chat-completion JSONL
 *
 * Usage:
 *   npx tsx src/convert.ts [options]
 *
 * Options:
 *   --training-dir <path>   Training data directory (default: ../training)
 *   --output <path>         Output JSONL file (default: ./data/sft-train.jsonl)
 *   --winners-only          Only include decisions from winning side (default: true)
 *   --all-sides             Include both winning and losing side decisions
 *   --min-version <ver>     Skip games before this version (e.g., 0.5.3)
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "fs";
import { join, basename } from "path";

// ── Types ──

interface Position {
  x: number;
  y: number;
}

interface UnitSnapshot {
  id: string;
  name: string;
  class: string;
  side: "player" | "opponent";
  hp: number;
  maxHp: number;
  speed: number;
  position: Position;
  facing: string;
  statusEffects: Array<{ type: string; [k: string]: unknown }>;
  prompt: string;
  originalPrompt?: string;
  healsUsed?: number;
}

interface TrapSnapshot {
  position: Position;
  owner: string;
  side: string;
}

interface TrainingEvent {
  type: string;
  [key: string]: unknown;
}

interface TrainingFile {
  configId: string;
  gameId: string;
  timestamp: string;
  agent: string;
  events: TrainingEvent[];
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface SFTExample {
  messages: ChatMessage[];
  metadata: {
    gameId: string;
    unitId: string;
    unitClass: string;
    side: string;
    round: number;
    won: boolean;
  };
}

// ── Board State Serialization ──

function serializeBoard(
  turnStart: TrainingEvent,
  unitId: string,
  gameConfig: TrainingEvent
): { system: string; user: string; unitClass: string; side: string } {
  const units = turnStart.units as UnitSnapshot[];
  const traps = (turnStart.traps as TrapSnapshot[]) || [];
  const round = turnStart.turn as number;
  const turnStack = turnStart.turnStack as string[];

  const unit = units.find((u) => u.id === unitId);
  if (!unit) throw new Error(`Unit ${unitId} not found in turn_start`);

  const allies = units.filter((u) => u.side === unit.side && u.id !== unitId && u.hp > 0);
  const enemies = units.filter((u) => u.side !== unit.side && u.hp > 0);

  // System prompt — class identity
  const classDescriptions: Record<string, string> = {
    sentinel:
      "SENTINEL (Tank) | 10HP, mv2, melee | Abilities: shield_wall (block damage from a direction), fortify (reduce damage, can't move), attack (1dmg, adjacent) | Passive: Denial — none",
    specter:
      "SPECTER (Infiltrator) | 5HP, mv3, melee | Abilities: cloak (go invisible), breach (replace enemy prompt, 2 uses/game, 2-turn cooldown, fades after 3 turns, must be behind target within 2 tiles), shadow_strike (2dmg from behind), attack (1dmg, adjacent) | Passive: none",
    oracle:
      "ORACLE (Scanner) | 8HP, mv2, rng4 | Abilities: scan (reveal enemy prompt, range ≤4), recalibrate (buff ally prompt, adjacent), attack (1dmg, adjacent) | Passive: Foresight (see enemy actions last turn)",
    striker:
      "STRIKER (Ranged DPS) | 4HP, mv2, rng3 | Abilities: precision_shot (2dmg, range ≤3, 1dmg if moved), suppressing_fire (1dmg line, range ≤3, slows), attack (1dmg, adjacent) | Passive: High Ground (+1 range if no adjacent enemy)",
    medic:
      "MEDIC (Healer) | 6HP, mv2, melee | Abilities: patch (heal adjacent ally 2HP, 3 uses/game), overclock (ally gets 2 abilities, costs 1HP self, adjacent), attack (1dmg, adjacent) | Passive: Triage (see exact ally HP)",
    vector:
      "VECTOR (Area Control) | 6HP, mv2, rng2 | Abilities: trap (invisible mine, range ≤2, 2dmg), pulse (1dmg all within 1 tile AoE), attack (1dmg, adjacent) | Passive: Denial (adjacent enemies can't use cloak/breach/scan/precision_shot/trap/patch/overclock)",
  };

  const system = `SIBYL tactical AI. You control ${unit.name}, a ${unit.class} on a 6x6 grid. Coords (x,y), (0,0)=bottom-left.

${classDescriptions[unit.class] || unit.class.toUpperCase()}

Rules: Each turn you get 2 actions — any combo of MOVE + ABILITY, or WAIT.
Respond with a JSON object: { "thinking": "...", "firstAction": {...}, "secondAction": {...} }
Actions: move { "type": "move", "target": { "x": N, "y": N } } | ability { "type": "ability", "ability": "name", "target": { "x": N, "y": N } } | wait { "type": "wait" }`;

  // User prompt — board state
  const lines: string[] = [];
  lines.push(`=== ROUND ${round} ===`);
  lines.push(`Your prompt: "${unit.prompt}"`);
  lines.push("");

  lines.push(`You: ${unit.name} (${unit.class}) at (${unit.position.x},${unit.position.y}), HP ${unit.hp}/${unit.maxHp}, facing ${unit.facing}`);
  if (unit.statusEffects.length > 0) {
    lines.push(`  Status: ${unit.statusEffects.map((s) => s.type).join(", ")}`);
  }
  lines.push("");

  if (allies.length > 0) {
    lines.push("Allies:");
    for (const a of allies) {
      const dist = Math.abs(a.position.x - unit.position.x) + Math.abs(a.position.y - unit.position.y);
      lines.push(`  ${a.name} (${a.class}) at (${a.position.x},${a.position.y}), HP ${a.hp}/${a.maxHp}, dist=${dist}`);
    }
    lines.push("");
  }

  if (enemies.length > 0) {
    lines.push("Enemies:");
    for (const e of enemies) {
      const dist = Math.abs(e.position.x - unit.position.x) + Math.abs(e.position.y - unit.position.y);
      const status = e.statusEffects.length > 0 ? ` [${e.statusEffects.map((s) => s.type).join(",")}]` : "";
      lines.push(`  ${e.name} (${e.class}) at (${e.position.x},${e.position.y}), HP ${e.hp}/${e.maxHp}, dist=${dist}${status}`);
    }
    lines.push("");
  }

  if (traps.length > 0) {
    const myTraps = traps.filter((t) => t.side === unit.side);
    if (myTraps.length > 0) {
      lines.push(`Your traps: ${myTraps.map((t) => `(${t.position.x},${t.position.y})`).join(", ")}`);
    }
  }

  lines.push(`Turn order: ${turnStack.join(" → ")}`);

  return {
    system,
    user: lines.join("\n"),
    unitClass: unit.class,
    side: unit.side,
  };
}

// ── Decision Serialization ──

function serializeDecision(decision: TrainingEvent): string {
  const thinking = decision.thinking as string;
  const first = decision.firstAction as { type: string; ability?: string; target?: Position; direction?: string };
  const second = decision.secondAction as { type: string; ability?: string; target?: Position; direction?: string };

  return JSON.stringify({ thinking, firstAction: first, secondAction: second });
}

// ── Conversion Pipeline ──

function processGame(filePath: string, winnersOnly: boolean): SFTExample[] {
  const raw = JSON.parse(readFileSync(filePath, "utf-8")) as TrainingFile;
  const examples: SFTExample[] = [];

  // Find game config and game end
  const gameConfig = raw.events.find((e) => e.type === "game_config");
  const gameEnd = raw.events.find((e) => e.type === "game_end");
  if (!gameConfig || !gameEnd) return examples;

  const winner = gameEnd.winner as string | undefined;
  if (!winner) return examples; // draw or unfinished

  // Walk events: track current turn_start, collect decisions
  let currentTurnStart: TrainingEvent | null = null;

  for (const event of raw.events) {
    if (event.type === "turn_start") {
      currentTurnStart = event;
    } else if (event.type === "agent_decision" && currentTurnStart) {
      const unitId = event.unitId as string;
      const units = currentTurnStart.units as UnitSnapshot[];
      const unit = units.find((u) => u.id === unitId);
      if (!unit) continue;

      const won = unit.side === winner;
      if (winnersOnly && !won) continue;

      try {
        const { system, user, unitClass, side } = serializeBoard(
          currentTurnStart,
          unitId,
          gameConfig
        );
        const assistant = serializeDecision(event);

        examples.push({
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
            { role: "assistant", content: assistant },
          ],
          metadata: {
            gameId: raw.gameId,
            unitId,
            unitClass,
            side,
            round: currentTurnStart.turn as number,
            won,
          },
        });
      } catch {
        // skip malformed events
      }
    }
  }

  return examples;
}

// ── CLI ──

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    trainingDir: join(import.meta.dirname ?? ".", "../../training"),
    output: join(import.meta.dirname ?? ".", "../data/sft-train.jsonl"),
    winnersOnly: true,
    minVersion: "",
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--training-dir":
        opts.trainingDir = args[++i]!;
        break;
      case "--output":
        opts.output = args[++i]!;
        break;
      case "--all-sides":
        opts.winnersOnly = false;
        break;
      case "--winners-only":
        opts.winnersOnly = true;
        break;
      case "--min-version":
        opts.minVersion = args[++i]!;
        break;
    }
  }
  return opts;
}

function versionGte(file: string, minVersion: string): boolean {
  if (!minVersion) return true;
  const match = file.match(/v(\d+\.\d+\.\d+)/);
  if (!match) return true;
  const parts = match[1]!.split(".").map(Number);
  const minParts = minVersion.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((parts[i] ?? 0) > (minParts[i] ?? 0)) return true;
    if ((parts[i] ?? 0) < (minParts[i] ?? 0)) return false;
  }
  return true;
}

function main() {
  const opts = parseArgs();

  console.log("SIBYL SFT Converter");
  console.log(`  Training dir: ${opts.trainingDir}`);
  console.log(`  Output:       ${opts.output}`);
  console.log(`  Winners only: ${opts.winnersOnly}`);
  if (opts.minVersion) console.log(`  Min version:  ${opts.minVersion}`);
  console.log("");

  const files = readdirSync(opts.trainingDir)
    .filter((f) => f.startsWith("training-") && f.endsWith(".json"))
    .filter((f) => versionGte(f, opts.minVersion))
    .sort();

  if (files.length === 0) {
    console.error("No training files found!");
    process.exit(1);
  }

  let totalExamples = 0;
  let totalGames = 0;
  const classCounts: Record<string, number> = {};
  const allExamples: SFTExample[] = [];

  for (const file of files) {
    const examples = processGame(join(opts.trainingDir, file), opts.winnersOnly);
    if (examples.length > 0) {
      totalGames++;
      totalExamples += examples.length;
      for (const ex of examples) {
        classCounts[ex.metadata.unitClass] = (classCounts[ex.metadata.unitClass] || 0) + 1;
        allExamples.push(ex);
      }
    }
  }

  // Write JSONL
  const outDir = join(opts.output, "..");
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const jsonl = allExamples
    .map((ex) => JSON.stringify({ messages: ex.messages }))
    .join("\n");
  writeFileSync(opts.output, jsonl + "\n");

  // Also write with metadata for analysis
  const metaPath = opts.output.replace(".jsonl", "-meta.jsonl");
  const metaJsonl = allExamples.map((ex) => JSON.stringify(ex)).join("\n");
  writeFileSync(metaPath, metaJsonl + "\n");

  console.log(`✅ Converted ${totalGames} games → ${totalExamples} examples`);
  console.log(`   Output: ${opts.output}`);
  console.log(`   With metadata: ${metaPath}`);
  console.log("");
  console.log("Class distribution:");
  for (const [cls, count] of Object.entries(classCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cls}: ${count}`);
  }
}

main();
