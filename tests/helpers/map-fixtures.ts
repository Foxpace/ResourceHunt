import { BIOMES, generateMap, normalizeConfig } from "../../src/index.ts";
import type { Biome, GameConfig } from "../../src/engine/types.ts";

export const BIOME_IDS = Object.keys(BIOMES) as Biome[];
export const MAP_DIMENSIONS = [
  [13, 13],
  [14, 19],
  [33, 25],
  [13, 81],
  [81, 13],
  [81, 81],
] as const;
export type GeneratedMap = ReturnType<typeof generateMap>;

interface MapScenarioOptions {
  biomes?: Biome[];
  dimensions?: readonly (readonly [number, number])[];
  layouts?: GameConfig["baseLayout"][];
  botCounts?: number[];
  seeds?: string[];
  config?: Partial<GameConfig>;
}

export function combineCases<Scenario>(dimensions: {
  [Key in keyof Scenario]: readonly Scenario[Key][];
}): Scenario[] {
  let scenarios: Partial<Scenario>[] = [{}];
  for (const [property, values] of Object.entries(dimensions)) {
    scenarios = scenarios.flatMap((scenario) =>
      (values as unknown[]).map((value) => ({ ...scenario, [property]: value })),
    );
  }

  return scenarios as Scenario[];
}

export function createMapScenarios(options: MapScenarioOptions = {}) {
  const variants = combineCases({
    biome: options.biomes ?? ["riverlands" as const],
    dimensions: options.dimensions ?? [[33, 25] as const],
    baseLayout: options.layouts ?? ["edges" as const, "center" as const],
    botCount: options.botCounts ?? [4],
    seed: options.seeds ?? ["test"],
  });

  return variants.map(({ dimensions: [width, height], botCount, ...settings }) => ({
    config: normalizeConfig({ width, height, ...settings, ...options.config }),
    botCount,
    label: `${settings.biome}, ${width}x${height}, ${settings.baseLayout}, ${botCount} bots, ${settings.seed}`,
  }));
}

export function numberedSeeds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}
