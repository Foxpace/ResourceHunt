import type { Biome, Terrain } from "../../engine/types.ts";

export type Swatch = readonly [base: string, detail: string];

const colors: Record<Terrain, Swatch> = {
  grass: ["#3b5934", "#5f8247"],
  forest: ["#30492c", "#3f6a39"],
  mountain: ["#5b5a4b", "#a39d84"],
  water: ["#1d566a", "#5aa7bc"],
  bridge: ["#1d566a", "#b88f57"],
  sand: ["#c89a5c", "#e6c48d"],
  dune: ["#b07b44", "#ddb06e"],
  oasis: ["#5d7c4a", "#a7c77c"],
  regolith: ["#585d72", "#80879f"],
  crater: ["#40455a", "#6e7692"],
  cliff: ["#3c3f48", "#7a8090"],
  basalt: ["#38343b", "#5b525d"],
  ash: ["#635657", "#8d7779"],
  lava: ["#c4401e", "#ffb54a"],
  snow: ["#c3d6df", "#f1f8fa"],
  ice: ["#7bb8cc", "#cdeef5"],
  thicket: ["#1c3424", "#2d5034"],
};

const themes: Partial<Record<Biome, Partial<Record<Terrain, Swatch>>>> = {
  valley: {
    grass: ["#4f653f", "#7d8f5a"],
    mountain: ["#625749", "#a99a7d"],
    cliff: ["#3b3330", "#7d6a55"],
  },
  desert: {
    mountain: ["#86563a", "#cf9b69"],
    cliff: ["#5c3f31", "#a07454"],
    water: ["#2a7a7a", "#72c2ad"],
  },
  moon: { mountain: ["#666b7e", "#aab0c2"], cliff: ["#282c3b", "#666f88"] },
  volcanic: { mountain: ["#473b41", "#8b6e75"], cliff: ["#2b262e", "#6b5560"] },
  archipelago: {
    grass: ["#3b6d48", "#5f925f"],
    water: ["#1a5c74", "#48a0b5"],
    bridge: ["#1a5c74", "#d1b88a"],
  },
  tundra: { mountain: ["#6a8592", "#e2eef1"], water: ["#264d6b", "#5a8db0"] },
  forest: { grass: ["#44563b", "#6a7b4f"], forest: ["#2c4530", "#4f7a48"] },
};

/** Ambient frame colors used behind the board for each biome. */
export const BIOME_AMBIENCE: Record<Biome, string> = {
  riverlands: "#2c6a5a",
  valley: "#5d6a3c",
  desert: "#9a6a36",
  moon: "#4b5577",
  volcanic: "#8a3622",
  archipelago: "#1f6e88",
  tundra: "#5c8ea6",
  forest: "#2f5b35",
};

export function terrainSwatch(terrain: Terrain, biome: Biome): Swatch {
  return themes[biome]?.[terrain] ?? colors[terrain];
}

/** Stable per-tile noise so texture never flickers between redraws. */
export function tileNoise(x: number, y: number, salt = 0): number {
  let hash =
    Math.imul(x + 374761393, 668265263) ^ Math.imul(y + salt * 31 + 1442695041, 2246822519);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489917);

  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}

export type TerrainClass = "liquid" | "raised" | "canopy" | "ground";

export function terrainClass(terrain: Terrain | undefined): TerrainClass {
  const liquid = terrain === "water" || terrain === "lava";
  if (liquid) return "liquid";

  const raised = terrain === "cliff" || terrain === "mountain";
  if (raised) return "raised";

  const canopy = terrain === "forest" || terrain === "thicket";
  return canopy ? "canopy" : "ground";
}
