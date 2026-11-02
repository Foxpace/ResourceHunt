import type { Biome, Terrain } from "./types.ts";

export interface BiomeDefinition {
  name: string;
  description: string;
  spawnTerrain: Terrain;
  connectorTerrain: Terrain;
}

/** Shared biome IDs and descriptions for bots, the CLI, and the browser. */
export const BIOMES: Record<Biome, BiomeDefinition> = {
  riverlands: {
    name: "Riverlands",
    description: "Open fields divided by a winding river and bank-to-bank bridges.",
    spawnTerrain: "grass",
    connectorTerrain: "bridge",
  },
  valley: {
    name: "Valley",
    description: "One valley branch per player, with cliff ridges and shared passes.",
    spawnTerrain: "grass",
    connectorTerrain: "grass",
  },
  desert: {
    name: "Desert",
    description: "Oasis starts, slow dune bands, and rocky mesas.",
    spawnTerrain: "oasis",
    connectorTerrain: "sand",
  },
  moon: {
    name: "Moon",
    description: "A crater start for every player, with rim exits and lunar plains.",
    spawnTerrain: "regolith",
    connectorTerrain: "regolith",
  },
  volcanic: {
    name: "Volcanic",
    description: "A lava caldera and radial flows separated by basalt causeways.",
    spawnTerrain: "basalt",
    connectorTerrain: "basalt",
  },
  archipelago: {
    name: "Archipelago",
    description: "Island starts with equal-length crossings and matching bridge access.",
    spawnTerrain: "grass",
    connectorTerrain: "bridge",
  },
  tundra: {
    name: "Tundra",
    description: "Slow snowfields around frozen lakes and fast ice routes.",
    spawnTerrain: "ice",
    connectorTerrain: "ice",
  },
  forest: {
    name: "Forest",
    description: "A maze of clearings and paths through impassable thickets.",
    spawnTerrain: "grass",
    connectorTerrain: "grass",
  },
};
