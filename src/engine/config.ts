import { DEFAULT_CONFIG, type GameConfig } from "./types.ts";
import { BIOMES } from "./biomes.ts";

export function normalizeConfig(input: Partial<GameConfig> = {}): GameConfig {
  const config = { ...DEFAULT_CONFIG, ...input };
  if (typeof config.biome !== "string" || !Object.hasOwn(BIOMES, config.biome)) {
    throw new Error(`biome must be one of: ${Object.keys(BIOMES).join(", ")}`);
  }
  const integer = (
    key:
      | "width"
      | "height"
      | "ticks"
      | "capacity"
      | "decisionTimeoutMs"
      | "hotspotCount"
      | "outpostCount"
      | "captureTurns"
      | "stealCooldownTicks",
    min: number,
    max: number,
  ) => {
    if (!Number.isInteger(config[key]) || config[key] < min || config[key] > max)
      throw new Error(`${key} must be an integer between ${min} and ${max}`);
  };
  integer("width", 13, 81);
  integer("height", 13, 81);
  integer("ticks", 1, 10000);
  integer("capacity", 3, 100);
  integer("decisionTimeoutMs", 10, 5000);
  integer("hotspotCount", 0, 6);
  integer("outpostCount", 0, 6);
  integer("captureTurns", 1, 20);
  integer("stealCooldownTicks", 1, 100);
  if (typeof config.stealing !== "boolean") throw new Error("stealing must be true or false");
  for (const key of ["resourceDensity", "terrainDensity"] as const) {
    if (!Number.isFinite(config[key]) || config[key] < 0 || config[key] > 0.65)
      throw new Error(`${key} must be between 0 and 0.65`);
  }
  if (typeof config.seed !== "string" || !config.seed.length || config.seed.length > 200)
    throw new Error("seed must contain 1 to 200 characters");
  if (config.baseLayout !== "edges" && config.baseLayout !== "center")
    throw new Error("baseLayout must be edges or center");
  return config;
}
