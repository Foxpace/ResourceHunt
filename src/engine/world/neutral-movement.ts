import { manhattanDistance } from "../grid.ts";
import { DIRECTIONS, terrainCost } from "../pathfinding.ts";
import type { GameMap, Position } from "../types.ts";

export function traversableNeighbors(map: GameMap, position: Position): Position[] {
  return [DIRECTIONS.N, DIRECTIONS.E, DIRECTIONS.S, DIRECTIONS.W]
    .map((delta) => ({ x: position.x + delta.x, y: position.y + delta.y }))
    .filter((cell) => Number.isFinite(terrainCost(map, cell)));
}

export function patrolStep(candidates: Position[], tick: number): Position | undefined {
  return candidates[Math.floor(tick / 2) % candidates.length];
}

export function nearestPosition(target: Position, candidates: Position[]): Position | undefined {
  return candidates.sort(
    (first, second) => manhattanDistance(first, target) - manhattanDistance(second, target),
  )[0];
}
