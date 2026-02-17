/**
 * CLI-based agent — uses `claude` CLI (Claude Code) to leverage
 * a Claude Pro/Max subscription instead of API credits.
 *
 * Single-call approach: pre-computes all recon data and injects it
 * into the prompt so no tool loop is needed.
 */

import { spawn } from "child_process";
import type { GameContext, UnitAction } from "../types";
import type { UnitClass } from "../types";
import {
  buildSystemPrompt,
  buildContextPrompt,
  buildPlayerPromptSection,
  buildPlacementPrompt,
} from "./prompts";
import { executeTool } from "./tools";

export interface AgentResponse {
  thinking: string;
  firstAction: UnitAction;
  secondAction: UnitAction;
}

export interface PlacementResponse {
  thinking: string;
  placements: { name: string; position: { x: number; y: number } }[];
}

export const CLAUDE_MODEL = "sonnet";

/** Full model identifier for training data provenance.
 * Pin this to the exact model version — "sonnet" resolves to latest,
 * but training data needs to know exactly which model generated it. */
export const CLAUDE_MODEL_ID = "claude-sonnet-4.5-20250514";

/**
 * Run a prompt through `claude` CLI and return the text output.
 * Uses stdin pipe to avoid shell argument length limits.
 */
async function callClaude(systemPrompt: string, userPrompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const fullPrompt = `<system>\n${systemPrompt}\n</system>\n\n${userPrompt}`;

    const args = [
      "--print",
      "--model",
      CLAUDE_MODEL,
      "--no-session-persistence",
      "--output-format",
      "text",
    ];

    const { ANTHROPIC_API_KEY: _, ...cleanEnv } = process.env;
    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: cleanEnv,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 500)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude CLI: ${err.message}`));
    });

    // Write prompt to stdin and close
    proc.stdin.write(fullPrompt);
    proc.stdin.end();
  });
}

/**
 * Pre-compute all useful recon data for a unit so the LLM
 * doesn't need tool access.
 */
function gatherRecon(ctx: GameContext): string {
  const sections: string[] = [];

  // Valid moves
  const moves = executeTool(ctx, "get_valid_moves", {});
  sections.push(`## Valid Moves\n${moves.output}`);

  // Enemies in range from current position
  const inRange = executeTool(ctx, "get_enemies_in_range", {});
  sections.push(`## Enemies In Range (current position)\n${inRange.output}`);

  // For each enemy, check range and path options
  for (const enemy of ctx.enemies) {
    if (enemy.cloaked) continue;
    const rangeCheck = executeTool(ctx, "check_range", {
      target_x: enemy.position.x,
      target_y: enemy.position.y,
    });
    sections.push(`## Range to ${enemy.name}\n${rangeCheck.output}`);

    // If specter, check behind positions
    if (ctx.unit.class === "specter") {
      const behind = executeTool(ctx, "check_behind", { enemy_id: enemy.name });
      sections.push(`## Behind check: ${enemy.name}\n${behind.output}`);

      const paths = executeTool(ctx, "get_path_options", {
        enemy_id: enemy.name,
        need_behind: true,
      });
      sections.push(`## Positions behind ${enemy.name} (reachable)\n${paths.output}`);
    }
  }

  // Simulate a few promising move positions (closest to enemies)
  const movesData = JSON.parse(executeTool(ctx, "get_valid_moves", {}).output);
  const validMoves: { x: number; y: number }[] = movesData.valid_moves || [];

  // Pick up to 3 most interesting moves (closest to nearest enemy)
  if (ctx.enemies.length > 0 && validMoves.length > 0) {
    const scored = validMoves.map((m) => {
      const minDist = Math.min(
        ...ctx.enemies
          .filter((e) => !e.cloaked)
          .map((e) => Math.abs(m.x - e.position.x) + Math.abs(m.y - e.position.y)),
      );
      return { ...m, minDist };
    });
    scored.sort((a, b) => a.minDist - b.minDist);
    const top = scored.slice(0, 3);

    for (const pos of top) {
      const sim = executeTool(ctx, "simulate_move", { target_x: pos.x, target_y: pos.y });
      sections.push(`## If you moved to (${pos.x},${pos.y})\n${sim.output}`);
    }
  }

  return sections.join("\n\n");
}

export async function getUnitAction(ctx: GameContext): Promise<AgentResponse> {
  const systemPrompt = buildSystemPrompt(ctx.unit);
  const contextPrompt = buildContextPrompt(ctx);
  const playerPrompt = buildPlayerPromptSection(ctx.unit);

  console.error(`  [cli-agent] ${ctx.unit.name} gathering recon...`);
  const recon = gatherRecon(ctx);

  console.error(`  [cli-agent] ${ctx.unit.name} calling claude CLI...`);

  const userPrompt = `${contextPrompt}\n${playerPrompt}

## Reconnaissance Data (pre-computed)
${recon}

Based on the above, decide your actions. Respond with ONLY a JSON code block:
\`\`\`json
{
  "thinking": "brief tactical reasoning",
  "firstAction": { "type": "move"|"ability"|"wait", ... },
  "secondAction": { "type": "move"|"ability"|"wait", ... }
}
\`\`\`

For move: { "type": "move", "target": { "x": number, "y": number } }
For ability: { "type": "ability", "ability": "ability_name", "target": { "x": number, "y": number }, "direction": "N"|"S"|"E"|"W", "addendum": "text" }
For wait: { "type": "wait" }

IMPORTANT: Output ONLY the JSON code block. No other text.`;

  const text = await callClaude(systemPrompt, userPrompt);
  return parseAgentResponse(text, ctx.unit.name);
}

export async function getPlacement(
  units: { name: string; class: UnitClass }[],
  side: "player" | "opponent",
  prompt: string,
): Promise<PlacementResponse> {
  const systemPrompt = buildPlacementPrompt(units, side);

  const userPrompt = `${prompt}

Decide where to place your units. Respond with ONLY a JSON code block:
\`\`\`json
{
  "thinking": "placement reasoning",
  "placements": [
    { "name": "unit_name", "position": { "x": number, "y": number } }
  ]
}
\`\`\`

IMPORTANT: Output ONLY the JSON code block. No other text.`;

  console.error(`  [cli-agent] placing ${side} units...`);
  const text = await callClaude(systemPrompt, userPrompt);
  return parsePlacementResponse(text);
}

function parseAgentResponse(text: string, unitName?: string): AgentResponse {
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : text;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(
      `  [cli-agent] WARNING: ${unitName || "unit"} no JSON found, falling back to wait`,
    );
    console.error(`  [cli-agent] Raw output: ${text.slice(0, 300)}`);
    return {
      thinking: text.slice(0, 200),
      firstAction: { type: "wait" },
      secondAction: { type: "wait" },
    };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      thinking: parsed.thinking || "",
      firstAction: parsed.firstAction || { type: "wait" },
      secondAction: parsed.secondAction || { type: "wait" },
    };
  } catch {
    console.error(`  [cli-agent] WARNING: ${unitName || "unit"} JSON parse failed`);
    return {
      thinking: "parse error",
      firstAction: { type: "wait" },
      secondAction: { type: "wait" },
    };
  }
}

function parsePlacementResponse(text: string): PlacementResponse {
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : text;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`  [cli-agent] WARNING: placement no JSON found`);
    return { thinking: "", placements: [] };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { thinking: parsed.thinking || "", placements: parsed.placements || [] };
  } catch {
    return { thinking: "parse error", placements: [] };
  }
}
