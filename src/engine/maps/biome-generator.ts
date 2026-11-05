import { BIOME_TEMPLATES } from "./template-registry.ts";
import { clearStartingAreas, clearBaseNeighborhood } from "./starting-areas.ts";
import type { BiomeTemplate, GeneratedBiome } from "./generation-models.ts";
import type { Biome, GameConfig, GameMap, Position } from "../types.ts";

export function generateBiome(
  config: GameConfig,
  proposedBases: Position[],
  random: () => number,
): GeneratedBiome {
  const template = BIOME_TEMPLATES[config.biome];
  const context = {
    bases: proposedBases,
    width: config.width,
    height: config.height,
    roughness: config.terrainDensity,
    random,
  };
  const map = {
    width: config.width,
    height: config.height,
    tiles: template.generateTerrain(context),
  };
  const bases = template.selectBases?.(map, proposedBases) ?? proposedBases;
  const openingCells = baseOpeningCells(bases, config.height);

  prepareBases({ map, biome: config.biome }, bases, template);
  const startingAreas = clearStartingAreas(map, bases, config.biome);
  const terrain = { map, bases, openingCells };
  template.connectTerrain({ ...terrain, startingAreas, biome: config.biome, random });

  return terrain;
}

function prepareBases(
  terrain: { map: GameMap; biome: Biome },
  bases: Position[],
  template: BiomeTemplate,
): void {
  const { map, biome } = terrain;

  for (const base of bases) {
    clearBaseNeighborhood(map, base, biome);
    template.clearApproach?.(map, base);
  }
}

function baseOpeningCells(bases: Position[], height: number): Position[] {
  const centerY = (height - 1) / 2;

  return bases.map((base) => ({
    x: base.x,
    y: base.y + (base.y < centerY ? 1 : -1),
  }));
}
