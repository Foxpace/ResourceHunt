import { BIOMES } from "./biomes.ts";
import { DIRECTIONS, terrainCost } from "./pathfinding.ts";
import type { Biome, GameMap, Position } from "./types.ts";

/** Join disconnected land with the shortest blocked crossing, preserving the larger template. */
export function connectLand(map: GameMap, origin: Position, biome: Biome): void {
  const count = map.width * map.height;
  const neighbors = (id: number) =>
    Object.values(DIRECTIONS)
      .map((delta) => ({ x: (id % map.width) + delta.x, y: Math.floor(id / map.width) + delta.y }))
      .filter((p) => p.x >= 0 && p.x < map.width && p.y >= 0 && p.y < map.height)
      .map((p) => p.y * map.width + p.x);
  const passable = (id: number) =>
    Number.isFinite(terrainCost(map, { x: id % map.width, y: Math.floor(id / map.width) }));
  function flood(): Set<number> {
    const start = origin.y * map.width + origin.x;
    const seen = new Set([start]);
    const queue = [start];
    for (let head = 0; head < queue.length; head++)
      for (const next of neighbors(queue[head]!)) {
        if (!seen.has(next) && passable(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    return seen;
  }
  let connected = flood();
  while (true) {
    const previous = new Int32Array(count).fill(-2);
    const queue = [...connected];
    for (const id of queue) previous[id] = -1;
    let target = -1;
    for (let head = 0; head < queue.length && target < 0; head++) {
      const current = queue[head]!;
      for (const next of neighbors(current)) {
        if (previous[next] !== -2) continue;
        previous[next] = current;
        if (passable(next)) {
          target = next;
          break;
        }
        queue.push(next);
      }
    }
    if (target < 0) return;
    for (let id = target; previous[id]! >= 0; id = previous[id]!) {
      if (passable(id)) continue;
      const x = id % map.width,
        y = Math.floor(id / map.width);
      const tile = map.tiles[y]![x]!;
      map.tiles[y]![x] =
        tile === "water"
          ? BIOMES[biome].connectorTerrain
          : biome === "desert"
            ? "sand"
            : BIOMES[biome].spawnTerrain;
    }
    connected = flood();
  }
}
