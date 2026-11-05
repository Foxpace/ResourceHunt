import type { TerrainGenerator, BiomeTemplate } from "../generation-models.ts";
import { connectGeneratedLand } from "../map-connectivity.ts";
import type { Terrain } from "../../types.ts";
import { createTerrainGrid, ellipseRadius } from "../terrain-tools.ts";

const generateMoonTerrain: TerrainGenerator = ({ width, height, roughness, random, bases }) => {
  const size = Math.max(3.5, Math.min(width, height) * (0.17 + roughness * 0.03 + random() * 0.02));
  const craters = bases.map((base) => ({
    ...base,
    rx: size,
    ry: size,
    gate: Math.atan2((height - 1) / 2 - base.y, (width - 1) / 2 - base.x),
  }));

  return createTerrainGrid({ width, height }, (x, y) => {
    let tile: Terrain = "regolith";

    for (const crater of craters) {
      const normalizedRadius = ellipseRadius({ x, y }, crater);
      if (normalizedRadius < 0.78) tile = "crater";
      else if (normalizedRadius < 1.15) {
        const angle = Math.atan2((y - crater.y) / crater.ry, (x - crater.x) / crater.rx);
        tile = Math.abs(Math.sin(angle - crater.gate)) < 0.28 ? "mountain" : "cliff";
      }
    }

    return tile;
  });
};

export const moon: BiomeTemplate = {
  generateTerrain: generateMoonTerrain,
  connectTerrain: connectGeneratedLand,
};
