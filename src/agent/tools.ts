/**
 * Game query tools for the agent SDK.
 * These let units ask questions about the board state
 * instead of doing mental math on coordinates.
 */

import type { GameContext, Position, UnitView } from "../types";
import { distance, isValidPosition, isBehind } from "../engine/game";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ToolResult {
  output: string;
}

// === Tool Definitions ===

export const GAME_TOOLS: ToolDefinition[] = [
  {
    name: "check_range",
    description:
      "Check if a target position is within your attack/ability range. Returns distance and whether it's in range.",
    parameters: {
      type: "object",
      properties: {
        target_x: { type: "number", description: "Target X coordinate" },
        target_y: { type: "number", description: "Target Y coordinate" },
      },
      required: ["target_x", "target_y"],
    },
  },
  {
    name: "get_enemies_in_range",
    description:
      "List all visible enemies you can hit with your abilities from your current position (or a hypothetical position).",
    parameters: {
      type: "object",
      properties: {
        from_x: {
          type: "number",
          description: "Check from this X instead of current position (optional)",
        },
        from_y: {
          type: "number",
          description: "Check from this Y instead of current position (optional)",
        },
      },
    },
  },
  {
    name: "get_valid_moves",
    description:
      "List all valid tiles you can move to this turn, accounting for movement range and obstacles.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "check_behind",
    description:
      "Check if a position is behind a specific enemy (required for Breach). Returns whether you'd be behind them and what position you need.",
    parameters: {
      type: "object",
      properties: {
        enemy_id: { type: "string", description: "The enemy unit's ID or name" },
        from_x: {
          type: "number",
          description: "Check from this X (optional, defaults to current position)",
        },
        from_y: {
          type: "number",
          description: "Check from this Y (optional, defaults to current position)",
        },
      },
      required: ["enemy_id"],
    },
  },
  {
    name: "simulate_move",
    description:
      "Preview what enemies would be in range if you moved to a specific position. Helps plan move+ability combos.",
    parameters: {
      type: "object",
      properties: {
        target_x: { type: "number", description: "Position X to simulate from" },
        target_y: { type: "number", description: "Position Y to simulate from" },
      },
      required: ["target_x", "target_y"],
    },
  },
  {
    name: "get_path_options",
    description:
      "For a target enemy, find positions you could move to that would put you in range (or behind them for Breach).",
    parameters: {
      type: "object",
      properties: {
        enemy_id: { type: "string", description: "The enemy unit's ID or name" },
        need_behind: {
          type: "boolean",
          description: "If true, only return positions that are behind the enemy",
        },
      },
      required: ["enemy_id"],
    },
  },
];

// === Tool Execution ===

export function executeTool(
  ctx: GameContext,
  toolName: string,
  args: Record<string, any>
): ToolResult {
  switch (toolName) {
    case "check_range":
      return toolCheckRange(ctx, args.target_x, args.target_y);
    case "get_enemies_in_range":
      return toolGetEnemiesInRange(ctx, args.from_x, args.from_y);
    case "get_valid_moves":
      return toolGetValidMoves(ctx);
    case "check_behind":
      return toolCheckBehind(ctx, args.enemy_id, args.from_x, args.from_y);
    case "simulate_move":
      return toolSimulateMove(ctx, args.target_x, args.target_y);
    case "get_path_options":
      return toolGetPathOptions(ctx, args.enemy_id, args.need_behind);
    default:
      return { output: `Unknown tool: ${toolName}` };
  }
}

function toolCheckRange(ctx: GameContext, tx: number, ty: number): ToolResult {
  const pos = ctx.unit.position;
  const dist = distance(pos, { x: tx, y: ty });
  const effectiveRange = getEffectiveRange(ctx);
  const inRange = dist <= effectiveRange;

  return {
    output: JSON.stringify({
      your_position: pos,
      target: { x: tx, y: ty },
      distance: dist,
      your_range: effectiveRange,
      in_range: inRange,
      note: inRange ? "Target is in range." : `Target is ${dist - effectiveRange} tile(s) too far.`,
    }),
  };
}

function toolGetEnemiesInRange(ctx: GameContext, fromX?: number, fromY?: number): ToolResult {
  const pos = fromX !== undefined && fromY !== undefined
    ? { x: fromX, y: fromY }
    : ctx.unit.position;
  const range = getEffectiveRange(ctx);

  const inRange = ctx.enemies
    .filter((e) => !e.cloaked)
    .map((e) => ({
      id: e.id,
      name: e.name,
      class: e.class,
      position: e.position,
      status: e.status,
      distance: distance(pos, e.position),
      in_range: distance(pos, e.position) <= range,
    }))
    .filter((e) => e.in_range);

  return {
    output: JSON.stringify({
      from: pos,
      your_range: range,
      enemies_in_range: inRange,
      enemies_out_of_range: ctx.enemies
        .filter((e) => !e.cloaked && distance(pos, e.position) > range)
        .map((e) => ({
          name: e.name,
          distance: distance(pos, e.position),
          tiles_too_far: distance(pos, e.position) - range,
        })),
    }),
  };
}

function toolGetValidMoves(ctx: GameContext): ToolResult {
  const pos = ctx.unit.position;
  const maxMove = ctx.unit.statusEffects.some((e: any) => e.type === "suppressed")
    ? 1
    : ctx.unit.movement;

  const moves: Position[] = [];
  for (let dx = -maxMove; dx <= maxMove; dx++) {
    for (let dy = -maxMove; dy <= maxMove; dy++) {
      if (dx === 0 && dy === 0) continue;
      const target = { x: pos.x + dx, y: pos.y + dy };
      if (!isValidPosition(target)) continue;
      if (Math.abs(dx) + Math.abs(dy) > maxMove) continue;

      // Check occupancy (specter can pass through but not end on)
      const occupied = [...ctx.allies, ...ctx.enemies].some(
        (u) => u.position.x === target.x && u.position.y === target.y
      );
      if (occupied) continue;

      moves.push(target);
    }
  }

  return {
    output: JSON.stringify({
      current_position: pos,
      movement_range: maxMove,
      valid_moves: moves,
      total_options: moves.length,
    }),
  };
}

function toolCheckBehind(
  ctx: GameContext,
  enemyId: string,
  fromX?: number,
  fromY?: number
): ToolResult {
  const enemy = ctx.enemies.find(
    (e) => e.id === enemyId || e.name.toLowerCase() === enemyId.toLowerCase()
  );
  if (!enemy) {
    return { output: JSON.stringify({ error: `Enemy "${enemyId}" not found. Available: ${ctx.enemies.map((e) => e.name).join(", ")}` }) };
  }

  const pos = fromX !== undefined && fromY !== undefined
    ? { x: fromX, y: fromY }
    : ctx.unit.position;

  // Calculate "behind" positions based on facing
  const behindPositions: Position[] = [];
  switch (enemy.facing) {
    case "N": // facing north, behind = south
      behindPositions.push(
        { x: enemy.position.x, y: enemy.position.y - 1 },
        { x: enemy.position.x - 1, y: enemy.position.y - 1 },
        { x: enemy.position.x + 1, y: enemy.position.y - 1 }
      );
      break;
    case "S":
      behindPositions.push(
        { x: enemy.position.x, y: enemy.position.y + 1 },
        { x: enemy.position.x - 1, y: enemy.position.y + 1 },
        { x: enemy.position.x + 1, y: enemy.position.y + 1 }
      );
      break;
    case "E":
      behindPositions.push(
        { x: enemy.position.x - 1, y: enemy.position.y },
        { x: enemy.position.x - 1, y: enemy.position.y - 1 },
        { x: enemy.position.x - 1, y: enemy.position.y + 1 }
      );
      break;
    case "W":
      behindPositions.push(
        { x: enemy.position.x + 1, y: enemy.position.y },
        { x: enemy.position.x + 1, y: enemy.position.y - 1 },
        { x: enemy.position.x + 1, y: enemy.position.y + 1 }
      );
      break;
  }

  const validBehind = behindPositions.filter(
    (p) =>
      isValidPosition(p) &&
      distance(p, enemy.position) === 1 // must be adjacent
  );

  const isCurrentlyBehind =
    distance(pos, enemy.position) === 1 &&
    isBehindCheck(pos, enemy);

  return {
    output: JSON.stringify({
      enemy: { name: enemy.name, position: enemy.position, facing: enemy.facing },
      your_position: pos,
      is_adjacent: distance(pos, enemy.position) === 1,
      is_behind: isCurrentlyBehind,
      behind_positions: validBehind,
      note: isCurrentlyBehind
        ? "You ARE behind the enemy. Breach is possible!"
        : `Move to one of the behind_positions to get behind ${enemy.name}.`,
    }),
  };
}

function toolSimulateMove(ctx: GameContext, tx: number, ty: number): ToolResult {
  const target = { x: tx, y: ty };
  if (!isValidPosition(target)) {
    return { output: JSON.stringify({ error: "Position out of bounds" }) };
  }

  const dist = distance(ctx.unit.position, target);
  const maxMove = ctx.unit.statusEffects.some((e: any) => e.type === "suppressed")
    ? 1
    : ctx.unit.movement;

  if (dist > maxMove) {
    return {
      output: JSON.stringify({
        error: `Can't reach (${tx},${ty}) — distance ${dist}, movement ${maxMove}`,
      }),
    };
  }

  const range = getEffectiveRange(ctx);
  const enemiesInRange = ctx.enemies
    .filter((e) => !e.cloaked && distance(target, e.position) <= range)
    .map((e) => ({
      name: e.name,
      class: e.class,
      position: e.position,
      distance: distance(target, e.position),
      status: e.status,
      is_behind: distance(target, e.position) === 1 && isBehindCheck(target, e),
    }));

  return {
    output: JSON.stringify({
      simulated_position: target,
      distance_to_move: dist,
      enemies_in_range: enemiesInRange,
      would_lose_fortify: ctx.unit.class === "sentinel",
      note_striker: ctx.unit.class === "striker"
        ? "WARNING: Precision Shot cannot be used after moving."
        : undefined,
    }),
  };
}

function toolGetPathOptions(
  ctx: GameContext,
  enemyId: string,
  needBehind?: boolean
): ToolResult {
  const enemy = ctx.enemies.find(
    (e) => e.id === enemyId || e.name.toLowerCase() === enemyId.toLowerCase()
  );
  if (!enemy) {
    return { output: JSON.stringify({ error: `Enemy "${enemyId}" not found.` }) };
  }

  const pos = ctx.unit.position;
  const maxMove = ctx.unit.statusEffects.some((e: any) => e.type === "suppressed")
    ? 1
    : ctx.unit.movement;
  const range = getEffectiveRange(ctx);

  const options: any[] = [];
  for (let dx = -maxMove; dx <= maxMove; dx++) {
    for (let dy = -maxMove; dy <= maxMove; dy++) {
      const target = { x: pos.x + dx, y: pos.y + dy };
      if (!isValidPosition(target)) continue;
      if (Math.abs(dx) + Math.abs(dy) > maxMove) continue;

      const occupied = [...ctx.allies, ...ctx.enemies].some(
        (u) => u.position.x === target.x && u.position.y === target.y
      );
      if (occupied && !(dx === 0 && dy === 0)) continue;

      const distToEnemy = distance(target, enemy.position);
      const inRange = distToEnemy <= range;
      const behind = distToEnemy === 1 && isBehindCheck(target, enemy);

      if (needBehind && !behind) continue;
      if (!needBehind && !inRange) continue;

      options.push({
        position: target,
        distance_to_enemy: distToEnemy,
        in_range: inRange,
        is_behind: behind,
        is_adjacent: distToEnemy === 1,
      });
    }
  }

  return {
    output: JSON.stringify({
      enemy: { name: enemy.name, position: enemy.position, facing: enemy.facing },
      reachable_options: options,
      total: options.length,
      note: options.length === 0
        ? `No reachable positions ${needBehind ? "behind" : "in range of"} ${enemy.name} this turn.`
        : undefined,
    }),
  };
}

// === Helpers ===

function getEffectiveRange(ctx: GameContext): number {
  let range = ctx.unit.range;
  // High Ground passive for striker
  if (ctx.unit.class === "striker") {
    const hasAdjacentEnemy = ctx.enemies.some(
      (e) => !e.cloaked && distance(ctx.unit.position, e.position) === 1
    );
    if (!hasAdjacentEnemy) range += 1;
  }
  return range;
}

function isBehindCheck(attackerPos: Position, target: UnitView): boolean {
  const dx = attackerPos.x - target.position.x;
  const dy = attackerPos.y - target.position.y;
  switch (target.facing) {
    case "N": return dy < 0;
    case "S": return dy > 0;
    case "E": return dx < 0;
    case "W": return dx > 0;
    default: return false;
  }
}
