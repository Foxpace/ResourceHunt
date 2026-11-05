import { manhattanDistance, cellsInRectangle } from "../grid.ts";
import { BIOMES } from "../biomes.ts";
import { positionKey } from "../pathfinding.ts";
import type { Biome, GameMap, Position } from "../types.ts";

interface StartingAreaContext {
  map: GameMap;
  biome: Biome;
  protectedCells: Map<string, Position>;
}

export const START_RADIUS = 3;

/** The same fast opening area for each player, independent of the underlying biome. */
export function clearStartingAreas(map: GameMap, bases: Position[], biome: Biome): Position[] {
  const protectedCells = new Map<string, Position>();
  const context = { map, biome, protectedCells };

  for (const base of bases) {
    clearBaseStartingArea(context, base);
  }

  return [...protectedCells.values()];
}

export function nearStart(position: Position, bases: Position[]): boolean {
  return bases.some((base) => manhattanDistance(position, base) <= START_RADIUS);
}

function clearStartingCell(
  context: StartingAreaContext,
  position: Position,
  base: Position,
): boolean {
  const { map, biome } = context;

  if (manhattanDistance(position, base) > START_RADIUS) return false;

  const tile = map.tiles[position.y]?.[position.x];
  if (!tile) return false;

  // Preserve island water lanes and their planned crossing lengths.
  const isArchipelago = biome === "archipelago";
  const isWaterLane = tile === "water" || tile === "bridge";
  const protectedWaterLane = isArchipelago && isWaterLane;
  if (protectedWaterLane) return false;

  map.tiles[position.y]![position.x] = BIOMES[biome].spawnTerrain;

  return true;
}

function clearBaseStartingArea(context: StartingAreaContext, base: Position): void {
  const { protectedCells } = context;

  for (const position of cellsInRectangle({
    left: base.x - START_RADIUS,
    top: base.y - START_RADIUS,
    right: base.x + START_RADIUS,
    bottom: base.y + START_RADIUS,
  })) {
    if (clearStartingCell(context, position, base))
      protectedCells.set(positionKey(position), position);
  }
}

/** Clear the immediate base neighborhood before biome-specific approach work. */
export function clearBaseNeighborhood(map: GameMap, base: Position, biome: Biome): void {
  for (const position of cellsInRectangle({
    left: base.x - 1,
    top: base.y - 1,
    right: base.x + 1,
    bottom: base.y + 1,
  }))
    map.tiles[position.y]![position.x] = BIOMES[biome].spawnTerrain;
}
