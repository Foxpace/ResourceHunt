import type { TerrainGenerator, BiomeTemplate } from "../generation-models.ts";
import { connectGeneratedLand } from "../map-connectivity.ts";
import type { MapDimensions } from "../../grid.ts";
import type { Position } from "../../types.ts";
import { createTerrainGrid } from "../terrain-tools.ts";

const generateForestTerrain: TerrainGenerator = ({ width, height, roughness, random }) => {
  const tiles = createTerrainGrid({ width, height }, () => "thicket");
  const stack: Position[] = [{ x: 1, y: 1 }];
  const seen = new Set(["1,1"]);
  tiles[1]![1] = "grass";

  while (stack.length) {
    const current = stack.at(-1)!;
    const next = unvisitedForestNeighbors(current, { width, height }, seen);
    if (!next.length) {
      stack.pop();
      continue;
    }

    const destination = next[Math.floor(random() * next.length)]!;
    seen.add(`${destination.x},${destination.y}`);
    tiles[(current.y + destination.y) / 2]![(current.x + destination.x) / 2] = "grass";
    tiles[destination.y]![destination.x] = random() < roughness ? "forest" : "grass";
    stack.push(destination);
  }

  return tiles;
};

export const forest: BiomeTemplate = {
  generateTerrain: generateForestTerrain,
  connectTerrain: connectGeneratedLand,
};

function unvisitedForestNeighbors(
  current: Position,
  dimensions: MapDimensions,
  seen: Set<string>,
): Position[] {
  const { width, height } = dimensions;

  return [
    { x: 2, y: 0 },
    { x: -2, y: 0 },
    { x: 0, y: 2 },
    { x: 0, y: -2 },
  ]
    .map((delta) => ({ x: current.x + delta.x, y: current.y + delta.y }))
    .filter((position) => {
      const insideColumns = position.x > 0 && position.x < width - 1;
      const insideRows = position.y > 0 && position.y < height - 1;
      const unvisited = !seen.has(`${position.x},${position.y}`);
      return insideColumns && insideRows && unvisited;
    });
}
