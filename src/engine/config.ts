import { DEFAULT_CONFIG, type GameConfig } from "./types.ts";
import { BIOMES } from "./biomes.ts";

export const MAX_SEED_LENGTH = 200;

export function normalizeConfig(input: Partial<GameConfig> = {}): GameConfig {
  const config = { ...DEFAULT_CONFIG, ...input };

  const unknownBiome = typeof config.biome !== "string" || !Object.hasOwn(BIOMES, config.biome);
  if (unknownBiome) {
    throw new Error(`biome must be one of: ${Object.keys(BIOMES).join(", ")}`);
  }

  for (const rule of INTEGER_RULES) validateInteger(config, rule);

  validateConfigOptions(config);

  return config;
}

function validateInteger(config: GameConfig, rule: IntegerRule): void {
  const { key, minimum, maximum } = rule;

  const value = config[key];
  const isInteger = Number.isInteger(value);
  const validInteger = isInteger ? value >= minimum && value <= maximum : false;
  if (!validInteger) throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
}

function validateConfigOptions(config: GameConfig): void {
  for (const key of ["stealing", "sabotage", "cargoTraps", "naturalEvents"] as const) {
    if (typeof config[key] !== "boolean") throw new Error(`${key} must be true or false`);
  }

  for (const key of ["resourceDensity", "terrainDensity"] as const) {
    const density = config[key];
    const isFiniteDensity = Number.isFinite(density);
    const validDensity = isFiniteDensity ? density >= 0 && density <= 0.65 : false;
    if (!validDensity) throw new Error(`${key} must be between 0 and 0.65`);
  }

  const seedLength = typeof config.seed === "string" ? config.seed.length : 0;
  const invalidSeed = seedLength < 1 || seedLength > MAX_SEED_LENGTH;
  if (invalidSeed) throw new Error(`seed must contain 1 to ${MAX_SEED_LENGTH} characters`);

  const unknownBaseLayout = config.baseLayout !== "edges" && config.baseLayout !== "center";
  if (unknownBaseLayout) throw new Error("baseLayout must be edges or center");
}

type IntegerConfigKey =
  | "scavengerCount"
  | "guardianCount"
  | "width"
  | "height"
  | "ticks"
  | "capacity"
  | "decisionTimeoutMs"
  | "hotspotCount"
  | "outpostCount"
  | "captureImmunityTicks"
  | "captureTurns"
  | "stealCooldownTicks";

interface IntegerRule {
  key: IntegerConfigKey;
  minimum: number;
  maximum: number;
}

const INTEGER_RULES: readonly IntegerRule[] = [
  { key: "scavengerCount", minimum: 0, maximum: 6 },
  { key: "guardianCount", minimum: 0, maximum: 6 },
  { key: "width", minimum: 13, maximum: 81 },
  { key: "height", minimum: 13, maximum: 81 },
  { key: "ticks", minimum: 1, maximum: 10000 },
  { key: "capacity", minimum: 3, maximum: 100 },
  { key: "decisionTimeoutMs", minimum: 10, maximum: 5000 },
  { key: "hotspotCount", minimum: 0, maximum: 6 },
  { key: "outpostCount", minimum: 0, maximum: 6 },
  { key: "captureImmunityTicks", minimum: 0, maximum: 20 },
  { key: "captureTurns", minimum: 1, maximum: 20 },
  { key: "stealCooldownTicks", minimum: 1, maximum: 100 },
];
