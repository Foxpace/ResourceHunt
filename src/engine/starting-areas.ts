import { BIOMES } from "./biomes.ts";
import { positionKey } from "./pathfinding.ts";
import type { Biome, GameMap, Position } from "./types.ts";

export const START_RADIUS = 3;

/** The same fast opening area for each player, independent of the underlying biome. */
export function clearStartingAreas(map: GameMap, bases: Position[], biome: Biome): Position[] {
  const protectedCells = new Map<string, Position>();
  for (const base of bases) {
    for (let dy = -START_RADIUS; dy <= START_RADIUS; dy++) {
      for (let dx = -START_RADIUS; dx <= START_RADIUS; dx++) {
        if (Math.abs(dx) + Math.abs(dy) > START_RADIUS) continue;
        const p = { x: base.x + dx, y: base.y + dy };
        const tile = map.tiles[p.y]?.[p.x];
        if (!tile) continue;
        // Island water lanes and their planned crossing lengths remain intact.
        if (biome === "archipelago" && (tile === "water" || tile === "bridge")) continue;
        map.tiles[p.y]![p.x] = BIOMES[biome].spawnTerrain;
        protectedCells.set(positionKey(p), p);
      }
    }
  }
  return [...protectedCells.values()];
}

export function nearStart(p: Position, bases: Position[]): boolean {
  return bases.some((base) => Math.abs(p.x - base.x) + Math.abs(p.y - base.y) <= START_RADIUS);
}
