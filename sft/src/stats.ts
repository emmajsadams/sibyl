#!/usr/bin/env npx tsx
/**
 * Show stats about converted SFT data
 *
 * Usage: npx tsx src/stats.ts [data/sft-train.jsonl]
 */

import { readFileSync } from "fs";
import { join } from "path";

const file = process.argv[2] || join(import.meta.dirname ?? ".", "../data/sft-train-meta.jsonl");
const lines = readFileSync(file, "utf-8").trim().split("\n");

interface Example {
  messages: { role: string; content: string }[];
  metadata: {
    gameId: string;
    unitId: string;
    unitClass: string;
    side: string;
    round: number;
    won: boolean;
  };
}

const examples: Example[] = lines.map((l) => JSON.parse(l));

// Stats
const games = new Set(examples.map((e) => e.metadata.gameId));
const classes: Record<string, number> = {};
const rounds: number[] = [];
const sides: Record<string, number> = { player: 0, opponent: 0 };
const tokenEstimates: number[] = [];

for (const ex of examples) {
  classes[ex.metadata.unitClass] = (classes[ex.metadata.unitClass] || 0) + 1;
  rounds.push(ex.metadata.round);
  sides[ex.metadata.side]++;
  // Rough token estimate: ~4 chars per token
  const totalChars = ex.messages.reduce((sum, m) => sum + m.content.length, 0);
  tokenEstimates.push(Math.ceil(totalChars / 4));
}

const avgTokens = Math.round(tokenEstimates.reduce((a, b) => a + b, 0) / tokenEstimates.length);
const maxTokens = Math.max(...tokenEstimates);
const totalTokens = tokenEstimates.reduce((a, b) => a + b, 0);

console.log("SIBYL SFT Dataset Stats");
console.log("═══════════════════════");
console.log(`Total examples:  ${examples.length}`);
console.log(`From games:      ${games.size}`);
console.log(`Winners only:    ${examples.every((e) => e.metadata.won) ? "yes" : "no (mixed)"}`);
console.log("");
console.log("Class distribution:");
for (const [cls, count] of Object.entries(classes).sort((a, b) => b[1] - a[1])) {
  const pct = ((count / examples.length) * 100).toFixed(1);
  const bar = "█".repeat(Math.round(count / 2));
  console.log(`  ${cls.padEnd(10)} ${String(count).padStart(4)}  (${pct}%)  ${bar}`);
}
console.log("");
console.log("Side distribution:");
for (const [side, count] of Object.entries(sides)) {
  console.log(`  ${side}: ${count}`);
}
console.log("");
console.log("Round distribution:");
const roundCounts: Record<number, number> = {};
for (const r of rounds) roundCounts[r] = (roundCounts[r] || 0) + 1;
for (const [r, count] of Object.entries(roundCounts).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const bar = "█".repeat(count);
  console.log(`  R${String(r).padStart(2)}: ${String(count).padStart(3)}  ${bar}`);
}
console.log("");
console.log("Token estimates (approx):");
console.log(`  Avg per example: ${avgTokens}`);
console.log(`  Max per example: ${maxTokens}`);
console.log(`  Total dataset:   ${totalTokens.toLocaleString()}`);
