import Anthropic from "@anthropic-ai/sdk";
import type { GameContext, UnitAction } from "../types";
import type { UnitClass } from "../types";
import {
  buildSystemPrompt,
  buildContextPrompt,
  buildPlayerPromptSection,
  buildPlacementPrompt,
} from "./prompts";
import { executeTool } from "./tools";

const MODEL = "claude-sonnet-4-20250514";

const client = new Anthropic();

export interface AgentResponse {
  thinking: string;
  firstAction: UnitAction;
  secondAction: UnitAction;
}

export interface PlacementResponse {
  thinking: string;
  placements: { name: string; position: { x: number; y: number } }[];
}

/** Pre-compute recon data server-side so the agent doesn't need tool calls. */
function buildRecon(ctx: GameContext): string {
  const recon: string[] = [];

  // Always useful
  recon.push(`valid_moves: ${executeTool(ctx, "get_valid_moves", {}).output}`);
  recon.push(`enemies_in_range: ${executeTool(ctx, "get_enemies_in_range", {}).output}`);

  // Specters need behind info for breach
  if (ctx.unit.class === "specter") {
    for (const enemy of ctx.enemies) {
      if (!enemy.cloaked) {
        recon.push(
          `check_behind(${enemy.name}): ${executeTool(ctx, "check_behind", { enemy_id: enemy.name }).output}`,
        );
      }
    }
  }

  // Strikers benefit from knowing which positions maximize targets
  if (ctx.unit.class === "striker") {
    // Get valid moves, then simulate the most promising ones
    const movesResult = JSON.parse(executeTool(ctx, "get_valid_moves", {}).output);
    const tiles = movesResult.tiles as number[][];
    // Sample up to 5 positions spread across the move options
    const sample = tiles.length <= 5 ? tiles : pickSpread(tiles, 5);
    for (const [x, y] of sample) {
      recon.push(
        `simulate_move(${x},${y}): ${executeTool(ctx, "simulate_move", { target_x: x, target_y: y }).output}`,
      );
    }
  }

  return recon.join("\n");
}

/** Pick N positions spread across the list (first, last, evenly spaced). */
function pickSpread(tiles: number[][], n: number): number[][] {
  if (tiles.length <= n) return tiles;
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.round((i * (tiles.length - 1)) / (n - 1));
    result.push(tiles[idx]!);
  }
  return result;
}

/**
 * Single LLM call per unit: pre-compute recon server-side, then one decision call.
 */
export async function getUnitAction(ctx: GameContext): Promise<AgentResponse> {
  const systemPrompt = buildSystemPrompt(ctx.unit);
  const contextPrompt = buildContextPrompt(ctx);
  const playerPrompt = buildPlayerPromptSection(ctx.unit);

  console.error(`  [agent] ${ctx.unit.name} pre-computing recon...`);
  const recon = buildRecon(ctx);

  console.error(`  [agent] ${ctx.unit.name} deciding...`);
  const decisionPrompt = `${contextPrompt}\n${playerPrompt}

Recon (pre-computed):
${recon}

Decide your actions. Respond per the JSON format in your instructions.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: decisionPrompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return parseAgentResponse(text, ctx.unit.name);
}

/**
 * Ask the AI agent to place units.
 */
export async function getPlacement(
  units: { name: string; class: UnitClass }[],
  side: "player" | "opponent",
  prompt: string,
): Promise<PlacementResponse> {
  const systemPrompt = buildPlacementPrompt(units, side);

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `${prompt}\n\nDecide where to place your units. Respond with ONLY a JSON code block:
\`\`\`json
{
  "thinking": "placement reasoning",
  "placements": [
    { "name": "unit_name", "position": { "x": number, "y": number } }
  ]
}
\`\`\``,
      },
    ],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return parsePlacementResponse(text);
}

function parseAgentResponse(text: string, unitName?: string): AgentResponse {
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : text;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error(`  [agent] WARNING: ${unitName || "unit"} no JSON found, falling back to wait`);
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
    console.error(
      `  [agent] WARNING: ${unitName || "unit"} JSON parse failed, falling back to wait`,
    );
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
    console.error(`  [agent] WARNING: placement no JSON found`);
    return { thinking: "", placements: [] };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { thinking: parsed.thinking || "", placements: parsed.placements || [] };
  } catch {
    return { thinking: "parse error", placements: [] };
  }
}
