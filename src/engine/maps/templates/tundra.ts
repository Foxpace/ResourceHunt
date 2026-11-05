import type { TerrainGenerator, BiomeTemplate } from "../generation-models.ts";
import { connectGeneratedLand } from "../map-connectivity.ts";
import { createTerrainGrid, createEllipse, ellipseRadius } from "../terrain-tools.ts";

const generateTundraTerrain: TerrainGenerator = ({ width, height, roughness, random, bases }) => {
  const lake = { x: (width - 1) / 2, y: (height - 1) / 2, rx: width * 0.32, ry: height * 0.35 };
  const pools = Array.from({ length: 3 }, () => createEllipse(random, { width, height }, 0.065));
  const phase = random() * Math.PI * 2;

  return createTerrainGrid({ width, height }, (x, y) => {
    const startDistance = Math.min(...bases.map((base) => Math.hypot(x - base.x, y - base.y)));
    if (startDistance < 3.5) return "ice";
    if (startDistance < 5) return "snow";
    if (pools.some((shape) => ellipseRadius({ x, y }, shape) < 0.65)) return "water";

    const insideLake = ellipseRadius({ x, y }, lake) < 1;
    const onFrozenStream = Math.abs(Math.sin(x * 0.13 + y * 0.26 + phase)) < 0.12;
    const onFrozenWater = insideLake || onFrozenStream;
    if (onFrozenWater) return "ice";

    return random() < roughness ? "mountain" : "snow";
  });
};

export const tundra: BiomeTemplate = {
  generateTerrain: generateTundraTerrain,
  connectTerrain: connectGeneratedLand,
};
