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
const MAX_TOOL_ROUNDS = 5;

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

/**
 * Convert our tool definitions to Anthropic API tool format.
 */
function buildApiTools(): Anthropic.Tool[] {
  return GAME_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters as Anthropic.Tool["input_schema"],
  }));
}

/**
 * Ask the AI agent what a unit should do this turn.
 * Uses Messages API with tool use for multi-step reasoning.
 */
export async function getUnitAction(ctx: GameContext): Promise<AgentResponse> {
  const systemPrompt = buildSystemPrompt(ctx.unit);
  const contextPrompt = buildContextPrompt(ctx);
  const playerPrompt = buildPlayerPromptSection(ctx.unit);
  const tools = buildApiTools();

  const userMessage = `${contextPrompt}\n${playerPrompt}

Use the available tools to verify ranges, check positions, and plan your moves before deciding. Do NOT guess distances — use check_range or get_enemies_in_range to verify.

Once you've gathered the information you need, output your final decision as a JSON block:
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

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  // Agentic loop: keep going until the model stops calling tools
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools,
      messages,
    });

    // Collect all content blocks
    const assistantContent = response.content;
    messages.push({ role: "assistant", content: assistantContent });

    // If stop_reason is end_turn or no tool_use blocks, we're done
    if (response.stop_reason === "end_turn" || !assistantContent.some((b) => b.type === "tool_use")) {
      const text = assistantContent
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      return parseAgentResponse(text);
    }

    // Process tool calls and build tool results
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of assistantContent) {
      if (block.type === "tool_use") {
        const result = executeTool(ctx, block.name, block.input as Record<string, any>);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result.output,
        });
      }
    }

    messages.push({ role: "user", content: toolResults });
  }

  throw new Error("Agent exceeded maximum tool rounds without producing a final answer");
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
        content: `${prompt}\n\nDecide where to place your units. Respond with JSON:
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

function parseAgentResponse(text: string): AgentResponse {
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : text;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Agent returned non-JSON response: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    thinking: parsed.thinking || "",
    firstAction: parsed.firstAction || { type: "wait" },
    secondAction: parsed.secondAction || { type: "wait" },
  };
}

function parsePlacementResponse(text: string): PlacementResponse {
  const codeBlockMatch = text.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = codeBlockMatch ? codeBlockMatch[1]! : text;
  const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Agent returned non-JSON response: ${text.slice(0, 300)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    thinking: parsed.thinking || "",
    placements: parsed.placements || [],
  };
}
