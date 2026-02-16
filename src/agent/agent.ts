// @ts-ignore — claude-code SDK
import { query } from "@anthropic-ai/claude-code";
import type { GameContext, TurnAction, UnitAction, Unit } from "../types";
import {
  buildSystemPrompt,
  buildContextPrompt,
  buildPlayerPromptSection,
  buildPlacementPrompt,
} from "./prompts";
import type { UnitClass } from "../types";

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
 * Ask the AI agent what a unit should do this turn.
 */
export async function getUnitAction(
  ctx: GameContext,
  abortSignal?: AbortSignal
): Promise<AgentResponse> {
  const systemPrompt = buildSystemPrompt(ctx.unit);
  const contextPrompt = buildContextPrompt(ctx);
  const playerPrompt = buildPlayerPromptSection(ctx.unit);

  const fullPrompt = `${contextPrompt}\n${playerPrompt}\n\nDecide your actions for this turn.`;

  const result = await query({
    prompt: fullPrompt,
    systemPrompt,
    options: {
      maxTurns: 1,
      model: "claude-sonnet-4-20250514",
    },
    abortController: abortSignal
      ? { signal: abortSignal, abort: () => {} }
      : undefined,
  });

  const text = (result as any[])
    .filter((m: any) => m.role === "assistant")
    .map((m: any) =>
      m.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("")
    )
    .join("");

  return parseAgentResponse(text);
}

/**
 * Ask the AI agent to place units.
 */
export async function getPlacement(
  units: { name: string; class: UnitClass }[],
  side: "player" | "opponent",
  prompt: string,
  abortSignal?: AbortSignal
): Promise<PlacementResponse> {
  const systemPrompt = buildPlacementPrompt(units, side);
  const fullPrompt = `${prompt}\n\nDecide where to place your units.`;

  const result = await query({
    prompt: fullPrompt,
    systemPrompt,
    options: {
      maxTurns: 1,
      model: "claude-sonnet-4-20250514",
    },
    abortController: abortSignal
      ? { signal: abortSignal, abort: () => {} }
      : undefined,
  });

  const text = (result as any[])
    .filter((m: any) => m.role === "assistant")
    .map((m: any) =>
      m.content
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text)
        .join("")
    )
    .join("");

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
