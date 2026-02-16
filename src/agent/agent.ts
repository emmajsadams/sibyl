import Anthropic from "@anthropic-ai/sdk";
import type { GameContext, UnitAction } from "../types";
import type { UnitClass } from "../types";
import {
  buildSystemPrompt,
  buildContextPrompt,
  buildPlayerPromptSection,
  buildPlacementPrompt,
} from "./prompts";

const client = new Anthropic();
const MODEL = "claude-sonnet-4-20250514";

export interface AgentResponse {
  thinking: string;
  firstAction: UnitAction;
  secondAction: UnitAction;
}

export interface PlacementResponse {
  thinking: string;
  placements: { name: string; position: { x: number; y: number } }[];
}

async function complete(system: string, user: string): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });

  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/**
 * Ask the AI agent what a unit should do this turn.
 */
export async function getUnitAction(ctx: GameContext): Promise<AgentResponse> {
  const systemPrompt = buildSystemPrompt(ctx.unit);
  const contextPrompt = buildContextPrompt(ctx);
  const playerPrompt = buildPlayerPromptSection(ctx.unit);
  const fullPrompt = `${contextPrompt}\n${playerPrompt}\n\nDecide your actions for this turn.`;

  const text = await complete(systemPrompt, fullPrompt);
  return parseAgentResponse(text);
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
  const fullPrompt = `${prompt}\n\nDecide where to place your units.`;

  const text = await complete(systemPrompt, fullPrompt);
  return parsePlacementResponse(text);
}

function parseAgentResponse(text: string): AgentResponse {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Agent returned non-JSON response: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    thinking: parsed.thinking || "",
    firstAction: parsed.firstAction || { type: "wait" },
    secondAction: parsed.secondAction || { type: "wait" },
  };
}

function parsePlacementResponse(text: string): PlacementResponse {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error(`Agent returned non-JSON response: ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(jsonMatch[0]);
  return {
    thinking: parsed.thinking || "",
    placements: parsed.placements || [],
  };
}
