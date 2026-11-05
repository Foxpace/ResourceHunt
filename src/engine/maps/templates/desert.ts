import type { TerrainGenerator, BiomeTemplate } from "../generation-models.ts";
import { connectGeneratedLand } from "../map-connectivity.ts";
import { createTerrainGrid, createEllipse, ellipseRadius } from "../terrain-tools.ts";

const generateDesertTerrain: TerrainGenerator = ({ width, height, roughness, random, bases }) => {
  const phase = random() * Math.PI * 2;
  const mesas = Array.from({ length: 3 }, () => createEllipse(random, { width, height }, 0.12));
  const oases = Array.from({ length: 2 }, () => createEllipse(random, { width, height }, 0.09));

  return createTerrainGrid({ width, height }, (x, y) => {
    const startDistance = Math.min(...bases.map((base) => Math.hypot(x - base.x, y - base.y)));
    if (startDistance < 3.5) return "oasis";
    if (startDistance < 5) return "sand";
    if (oases.some((shape) => ellipseRadius({ x, y }, shape) < 0.4)) return "water";
    if (oases.some((shape) => ellipseRadius({ x, y }, shape) < 1)) return "oasis";
    if (mesas.some((shape) => ellipseRadius({ x, y }, shape) < 0.6)) return "cliff";
    if (mesas.some((shape) => ellipseRadius({ x, y }, shape) < 1)) return "mountain";

    return Math.sin(x * 0.65 + y * 0.33 + phase) > 0.65 - roughness ? "dune" : "sand";
  });
};

export const desert: BiomeTemplate = {
  generateTerrain: generateDesertTerrain,
  connectTerrain: connectGeneratedLand,
};
