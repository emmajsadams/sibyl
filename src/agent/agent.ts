import Anthropic from "@anthropic-ai/sdk";
import type { GameContext, UnitAction } from "../types";
import type { UnitClass } from "../types";
import {
  buildSystemPrompt,
  buildContextPrompt,
  buildPlayerPromptSection,
  buildPlacementPrompt,
} from "./prompts";
import { GAME_TOOLS, executeTool } from "./tools";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOOL_ROUNDS = 3;

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

function buildApiTools(): Anthropic.Tool[] {
  return GAME_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool["input_schema"],
  }));
}

/**
 * Two-phase approach:
 * Phase 1: Let the agent use tools to gather info (agentic loop)
 * Phase 2: Single clean call with all gathered info, demanding JSON output
 */
export async function getUnitAction(ctx: GameContext): Promise<AgentResponse> {
  const systemPrompt = buildSystemPrompt(ctx.unit);
  const contextPrompt = buildContextPrompt(ctx);
  const playerPrompt = buildPlayerPromptSection(ctx.unit);
  const tools = buildApiTools();

  const userMessage = `${contextPrompt}\n${playerPrompt}

Use the available tools to verify ranges, check positions, and plan your moves. Do NOT guess distances.`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  // Phase 1: Tool gathering (up to MAX_TOOL_ROUNDS)
  const gatheredInfo: string[] = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    console.error(`  [agent] ${ctx.unit.name} recon ${round + 1}/${MAX_TOOL_ROUNDS}`);

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: systemPrompt,
      tools,
      messages,
    });

    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    const hasToolUse = assistantContent.some((b) => b.type === "tool_use");
    if (!hasToolUse) break;

    // Execute tools and collect results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of assistantContent) {
      if (block.type === "tool_use") {
        const result = executeTool(ctx, block.name, block.input as Record<string, any>);
        console.error(`  [agent] ${ctx.unit.name} → ${block.name}`);
        gatheredInfo.push(`${block.name}: ${result.output}`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.output,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });

    if (response.stop_reason === "end_turn") break;
  }

  // Phase 2: Clean decision call — no tools, just context + gathered info + demand JSON
  console.error(`  [agent] ${ctx.unit.name} deciding...`);

  const decisionPrompt = `${contextPrompt}\n${playerPrompt}

## Reconnaissance Results
${gatheredInfo.length > 0 ? gatheredInfo.join("\n\n") : "No recon data gathered."}

Based on the above information, decide your actions. Respond with ONLY a JSON code block:
\`\`\`json
{
  "thinking": "brief tactical reasoning",
  "firstAction": { "type": "move"|"ability"|"wait", ... },
  "secondAction": { "type": "move"|"ability"|"wait", ... }
}
\`\`\`

For move: { "type": "move", "target": { "x": number, "y": number } }
For ability: { "type": "ability", "ability": "ability_name", "target": { "x": number, "y": number }, "direction": "N"|"S"|"E"|"W", "addendum": "text" }
For wait: { "type": "wait" }`;

  const decisionResponse = await client.messages.create({
    model: MODEL,
    max_tokens: 512,
    system: systemPrompt,
    messages: [{ role: "user", content: decisionPrompt }],
  });

  const text = decisionResponse.content
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
  prompt: string
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
    return { thinking: text.slice(0, 200), firstAction: { type: "wait" }, secondAction: { type: "wait" } };
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      thinking: parsed.thinking || "",
      firstAction: parsed.firstAction || { type: "wait" },
      secondAction: parsed.secondAction || { type: "wait" },
    };
  } catch {
    console.error(`  [agent] WARNING: ${unitName || "unit"} JSON parse failed, falling back to wait`);
    return { thinking: "parse error", firstAction: { type: "wait" }, secondAction: { type: "wait" } };
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
