/**
 * Game query tools for the agent SDK.
 */

import type { GameContext, Position, UnitView } from "../types";
import { distance, isValidPosition } from "../engine/game";

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ToolResult {
  output: string;
}

export const GAME_TOOLS: ToolDefinition[] = [
  {
    name: "check_range",
    description: "Check distance and whether a target is in your ability range.",
    parameters: {
      type: "object",
      properties: {
        target_x: { type: "number", description: "Target X" },
        target_y: { type: "number", description: "Target Y" },
      },
      required: ["target_x", "target_y"],
    },
  },
  {
    name: "get_enemies_in_range",
    description: "List enemies you can hit from current or hypothetical position.",
    parameters: {
      type: "object",
      properties: {
        from_x: { type: "number", description: "Optional X override" },
        from_y: { type: "number", description: "Optional Y override" },
      },
    },
  },
  {
    name: "get_valid_moves",
    description: "List all tiles you can move to this turn.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "check_behind",
    description: "Check if you're behind an enemy (for Breach). Returns behind positions.",
    parameters: {
      type: "object",
      properties: {
        enemy_id: { type: "string", description: "Enemy ID or name" },
        from_x: { type: "number", description: "Optional X override" },
        from_y: { type: "number", description: "Optional Y override" },
      },
      required: ["enemy_id"],
    },
  },
  {
    name: "simulate_move",
    description: "Preview enemies in range if you moved to a position.",
    parameters: {
      type: "object",
      properties: {
        target_x: { type: "number", description: "X to simulate from" },
        target_y: { type: "number", description: "Y to simulate from" },
      },
      required: ["target_x", "target_y"],
    },
  },
  {
    name: "get_path_options",
    description: "Find reachable positions that put you in range (or behind) an enemy.",
    parameters: {
      type: "object",
      properties: {
        enemy_id: { type: "string", description: "Enemy ID or name" },
        need_behind: { type: "boolean", description: "Only behind positions" },
      },
      required: ["enemy_id"],
    },
  },
];

export function executeTool(
  ctx: GameContext,
  toolName: string,
  args: Record<string, any>,
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
  const dist = distance(ctx.unit.position, { x: tx, y: ty });
  const range = getEffectiveRange(ctx);
  return {
    output: JSON.stringify({
      target: [tx, ty],
      dist,
      inRange: dist <= range,
    }),
  };
}

function toolGetEnemiesInRange(ctx: GameContext, fromX?: number, fromY?: number): ToolResult {
  const pos =
    fromX !== undefined && fromY !== undefined ? { x: fromX, y: fromY } : ctx.unit.position;
  const range = getEffectiveRange(ctx);

  const inR = ctx.enemies
    .filter((e) => !e.cloaked)
    .filter((e) => distance(pos, e.position) <= range)
    .map((e) => ({
      name: e.name,
      cls: e.class,
      pos: [e.position.x, e.position.y],
      dist: distance(pos, e.position),
      status: e.status,
    }));

  const outR = ctx.enemies
    .filter((e) => !e.cloaked && distance(pos, e.position) > range)
    .map((e) => ({
      name: e.name,
      dist: distance(pos, e.position),
    }));

  return { output: JSON.stringify({ from: [pos.x, pos.y], inRange: inR, outRange: outR }) };
}

function toolGetValidMoves(ctx: GameContext): ToolResult {
  const pos = ctx.unit.position;
  const maxMove = ctx.unit.statusEffects.some((e: any) => e.type === "suppressed")
    ? 1
    : ctx.unit.movement;

  const moves: number[][] = [];
  for (let dx = -maxMove; dx <= maxMove; dx++) {
    for (let dy = -maxMove; dy <= maxMove; dy++) {
      if (dx === 0 && dy === 0) continue;
      const target = { x: pos.x + dx, y: pos.y + dy };
      if (!isValidPosition(target)) continue;
      if (Math.abs(dx) + Math.abs(dy) > maxMove) continue;
      const occupied = [...ctx.allies, ...ctx.enemies].some(
        (u) => u.position.x === target.x && u.position.y === target.y,
      );
      if (occupied) continue;
      moves.push([target.x, target.y]);
    }
  }

  return { output: JSON.stringify({ mv: maxMove, tiles: moves }) };
}

function toolCheckBehind(
  ctx: GameContext,
  enemyId: string,
  fromX?: number,
  fromY?: number,
): ToolResult {
  const enemy = ctx.enemies.find(
    (e) => e.id === enemyId || e.name.toLowerCase() === enemyId.toLowerCase(),
  );
  if (!enemy) {
    return {
      output: JSON.stringify({
        error: `Enemy "${enemyId}" not found. Available: ${ctx.enemies.map((e) => e.name).join(", ")}`,
      }),
    };
  }

  const pos =
    fromX !== undefined && fromY !== undefined ? { x: fromX, y: fromY } : ctx.unit.position;

  const behindPositions: Position[] = [];
  switch (enemy.facing) {
    case "N":
      behindPositions.push(
        { x: enemy.position.x, y: enemy.position.y - 1 },
        { x: enemy.position.x - 1, y: enemy.position.y - 1 },
        { x: enemy.position.x + 1, y: enemy.position.y - 1 },
      );
      break;
    case "S":
      behindPositions.push(
        { x: enemy.position.x, y: enemy.position.y + 1 },
        { x: enemy.position.x - 1, y: enemy.position.y + 1 },
        { x: enemy.position.x + 1, y: enemy.position.y + 1 },
      );
      break;
    case "E":
      behindPositions.push(
        { x: enemy.position.x - 1, y: enemy.position.y },
        { x: enemy.position.x - 1, y: enemy.position.y - 1 },
        { x: enemy.position.x - 1, y: enemy.position.y + 1 },
      );
      break;
    case "W":
      behindPositions.push(
        { x: enemy.position.x + 1, y: enemy.position.y },
        { x: enemy.position.x + 1, y: enemy.position.y - 1 },
        { x: enemy.position.x + 1, y: enemy.position.y + 1 },
      );
      break;
  }

  const validBehind = behindPositions
    .filter((p) => isValidPosition(p) && distance(p, enemy.position) === 1)
    .map((p) => [p.x, p.y]);

  const dist = distance(pos, enemy.position);
  const behind = dist <= 2 && isBehindCheck(pos, enemy);

  return {
    output: JSON.stringify({
      enemy: { name: enemy.name, pos: [enemy.position.x, enemy.position.y], facing: enemy.facing },
      dist,
      behind,
      behindTiles: validBehind,
    }),
  };
}

function toolSimulateMove(ctx: GameContext, tx: number, ty: number): ToolResult {
  const target = { x: tx, y: ty };
  if (!isValidPosition(target)) {
    return { output: JSON.stringify({ error: "Out of bounds" }) };
  }

  const dist = distance(ctx.unit.position, target);
  const maxMove = ctx.unit.statusEffects.some((e: any) => e.type === "suppressed")
    ? 1
    : ctx.unit.movement;

  if (dist > maxMove) {
    return { output: JSON.stringify({ error: `Unreachable: dist ${dist}, mv ${maxMove}` }) };
  }

  const range = getEffectiveRange(ctx);
  const enemies = ctx.enemies
    .filter((e) => !e.cloaked && distance(target, e.position) <= range)
    .map((e) => ({
      name: e.name,
      cls: e.class,
      pos: [e.position.x, e.position.y],
      dist: distance(target, e.position),
      status: e.status,
      behind: distance(target, e.position) === 1 && isBehindCheck(target, e),
    }));

  const result: any = { pos: [tx, ty], moveDist: dist, enemies };
  if (ctx.unit.class === "sentinel") result.losesFortify = true;
  if (ctx.unit.class === "striker") result.precShotReduced = true;
  return { output: JSON.stringify(result) };
}

function toolGetPathOptions(ctx: GameContext, enemyId: string, needBehind?: boolean): ToolResult {
  const enemy = ctx.enemies.find(
    (e) => e.id === enemyId || e.name.toLowerCase() === enemyId.toLowerCase(),
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
        (u) => u.position.x === target.x && u.position.y === target.y,
      );
      if (occupied && !(dx === 0 && dy === 0)) continue;

      const distToEnemy = distance(target, enemy.position);
      const inRange = distToEnemy <= range;
      const behind = distToEnemy === 1 && isBehindCheck(target, enemy);

      if (needBehind && !behind) continue;
      if (!needBehind && !inRange) continue;

      options.push({
        pos: [target.x, target.y],
        dist: distToEnemy,
        behind,
        adj: distToEnemy === 1,
      });
    }
  }

  return {
    output: JSON.stringify({
      enemy: { name: enemy.name, pos: [enemy.position.x, enemy.position.y], facing: enemy.facing },
      options,
    }),
  };
}

function getEffectiveRange(ctx: GameContext): number {
  let range = ctx.unit.range;
  if (ctx.unit.class === "striker") {
    const hasAdjacentEnemy = ctx.enemies.some(
      (e) => !e.cloaked && distance(ctx.unit.position, e.position) === 1,
    );
    if (!hasAdjacentEnemy) range += 1;
  }
  return range;
}

function isBehindCheck(attackerPos: Position, target: UnitView): boolean {
  const dx = attackerPos.x - target.position.x;
  const dy = attackerPos.y - target.position.y;
  switch (target.facing) {
    case "N":
      return dy < 0;
    case "S":
      return dy > 0;
    case "E":
      return dx < 0;
    case "W":
      return dx > 0;
    default:
      return false;
  }
}
