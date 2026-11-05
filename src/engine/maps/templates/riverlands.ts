import type {
  BiomeTemplate,
  TerrainGenerator,
  BiomeConnectionContext,
} from "../generation-models.ts";
import type { GameMap, Position } from "../../types.ts";
import { BIOMES } from "../../biomes.ts";
import { generateRiver } from "../river.ts";
import { createTerrainGrid } from "../terrain-tools.ts";

const generateRiverlandsTerrain: TerrainGenerator = ({ width, height, roughness, random }) =>
  createTerrainGrid({ width, height }, () => {
    const roll = random();

    return roll < roughness * 0.62 ? "forest" : roll < roughness ? "mountain" : "grass";
  });

export const riverlands: BiomeTemplate = {
  generateTerrain: generateRiverlandsTerrain,
  clearApproach: clearRiverlandsApproach,
  connectTerrain: connectRiverlandsTerrain,
};

function clearRiverlandsApproach(map: GameMap, base: Position): void {
  const clear = (position: Position) => {
    map.tiles[position.y]![position.x] = BIOMES.riverlands.spawnTerrain;
  };

  const position = { ...base };
  const center = { x: Math.round((map.width - 1) / 2), y: Math.round((map.height - 1) / 2) };

  while (position.x !== center.x) {
    position.x += Math.sign(center.x - position.x);
    clear(position);
  }

  while (position.y !== center.y) {
    position.y += Math.sign(center.y - position.y);
    clear(position);
  }
}

function connectRiverlandsTerrain(context: BiomeConnectionContext): void {
  const { map, bases, openingCells, startingAreas, random } = context;

  try {
    generateRiver(map, startingAreas, random);
  } catch (error) {
    const unexpectedRoutingError =
      !(error instanceof Error) || error.message !== "Unable to route a river around the bases";
    if (unexpectedRoutingError) throw error;

    generateRiver(map, [...bases, ...openingCells], random);
  }
}
