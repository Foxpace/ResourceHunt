import type { Biome } from "../types.ts";
import type { BiomeTemplate } from "./generation-models.ts";
import { riverlands } from "./templates/riverlands.ts";
import { valley } from "./templates/valley.ts";
import { desert } from "./templates/desert.ts";
import { moon } from "./templates/moon.ts";
import { volcanic } from "./templates/volcanic.ts";
import { archipelago } from "./templates/archipelago.ts";
import { tundra } from "./templates/tundra.ts";
import { forest } from "./templates/forest.ts";

export const BIOME_TEMPLATES: Record<Biome, BiomeTemplate> = {
  riverlands,
  valley,
  desert,
  moon,
  volcanic,
  archipelago,
  tundra,
  forest,
};
