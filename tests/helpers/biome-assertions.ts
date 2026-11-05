import assert from "node:assert/strict";
import { distanceField, positionKey } from "../../src/index.ts";
import { mapCells } from "../../src/engine/grid.ts";
import { DIRECTIONS } from "../../src/engine/pathfinding.ts";
import type { Biome, GameMap, Position, Terrain } from "../../src/engine/types.ts";
import type { GeneratedMap } from "./map-fixtures.ts";

const EXPECTED_TERRAIN: Record<Biome, Terrain[]> = {
  riverlands: ["grass", "water", "bridge"],
  valley: ["grass", "cliff", "mountain"],
  desert: ["sand", "dune", "oasis"],
  moon: ["regolith", "crater", "cliff"],
  volcanic: ["basalt", "ash", "lava"],
  archipelago: ["water", "bridge", "grass"],
  tundra: ["snow", "ice", "water"],
  forest: ["grass", "forest", "thicket"],
};

export function assertBiomeTerrain(map: GameMap, biome: Biome): void {
  const tiles = map.tiles.flat();
  for (const terrain of EXPECTED_TERRAIN[biome])
    assert.ok(tiles.includes(terrain), `Missing ${terrain}`);
  const hasNoGrass = biome === "moon" || biome === "volcanic";
  if (hasNoGrass) assert.ok(!tiles.includes("grass"));
  if (biome !== "archipelago") return;

  assert.ok(tiles.filter((tile) => tile === "water").length > tiles.length * 0.25);
  assert.ok(
    map.tiles.some((row, y) =>
      row.some((tile, x) => {
        const isBridge = tile === "bridge";
        const bridgeBelow = map.tiles[y + 1]?.[x] === "bridge";
        return isBridge && bridgeBelow;
      }),
    ),
    "Islands need vertical crossings too",
  );
}

export function assertIslandCrossings(generated: GeneratedMap): void {
  const { map, bases } = generated;
  const crossings = collectCrossings(map);
  assert.equal(new Set(crossings.map((crossing) => crossing.length)).size, 1);
  for (const crossing of crossings) assertMirroredCrossing(map, crossing);

  const bridgeKeys = crossings.flat().map(positionKey);
  for (const base of bases) {
    const arrivals = distanceField(map, base);
    assert.equal(Math.min(...bridgeKeys.map((key) => arrivals.get(key)!.cost)), 2);
  }
}

function collectCrossings(map: GameMap): Position[][] {
  const visited = new Set<string>();
  const crossings: Position[][] = [];
  for (const position of mapCells(map)) {
    const bridge = map.tiles[position.y]![position.x] === "bridge";
    const alreadyVisited = visited.has(positionKey(position));
    if (!bridge || alreadyVisited) continue;

    crossings.push(collectCrossing(map, position, visited));
  }

  return crossings;
}

function collectCrossing(map: GameMap, start: Position, visited: Set<string>): Position[] {
  const queue = [start];
  visited.add(positionKey(start));
  for (let index = 0; index < queue.length; index++) {
    const neighbors = Object.values(DIRECTIONS).map((delta) => ({
      x: queue[index]!.x + delta.x,
      y: queue[index]!.y + delta.y,
    }));
    const available = neighbors.filter((position) => {
      const isBridge = map.tiles[position.y]?.[position.x] === "bridge";
      const unvisited = !visited.has(positionKey(position));
      return isBridge && unvisited;
    });
    for (const position of available) visited.add(positionKey(position));

    queue.push(...available);
  }

  return queue;
}

function assertMirroredCrossing(map: GameMap, crossing: Position[]): void {
  const start = crossing[0]!;
  assert.ok(
    crossing.every((position) => position.x === start.x) ||
      crossing.every((position) => position.y === start.y),
  );
  for (const position of crossing) {
    assert.equal(map.tiles[position.y]![map.width - 1 - position.x], "bridge");
    assert.equal(map.tiles[map.height - 1 - position.y]![position.x], "bridge");
  }
}
