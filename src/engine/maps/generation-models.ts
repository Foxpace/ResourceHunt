import type { MapDimensions } from "../grid.ts";
import type { Biome, GameConfig, GameMap, Hotspot, Outpost, Position, Terrain } from "../types.ts";

export interface BiomeTemplateContext extends MapDimensions {
  bases: Position[];
  roughness: number;
  random: () => number;
}

export interface MapSetup {
  map: GameMap;
  config: GameConfig;
}

export interface StartingLayout {
  bases: Position[];
  protectedCells: Position[];
}

export interface GeneratedBiome {
  map: GameMap;
  bases: Position[];
  openingCells: Position[];
}

export interface CompetitionSites {
  hotspots: Hotspot[];
  outposts: Outpost[];
}

export interface ResourceLayout extends CompetitionSites, StartingLayout {}

export type TerrainGenerator = (context: BiomeTemplateContext) => Terrain[][];

export interface BiomeConnectionContext extends GeneratedBiome {
  startingAreas: Position[];
  biome: Biome;
  random: () => number;
}

export interface BiomeTemplate {
  generateTerrain: TerrainGenerator;
  selectBases?(map: GameMap, proposedBases: Position[]): Position[];
  clearApproach?(map: GameMap, base: Position): void;
  connectTerrain(context: BiomeConnectionContext): void;
}
