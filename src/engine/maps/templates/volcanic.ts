import type { TerrainGenerator, BiomeTemplate } from "../generation-models.ts";
import { connectGeneratedLand } from "../map-connectivity.ts";
import type { Terrain } from "../../types.ts";
import { createTerrainGrid } from "../terrain-tools.ts";

const generateVolcanicTerrain: TerrainGenerator = ({ width, height, roughness, random, bases }) => {
  const phase = random() * Math.PI * 2;

  return createTerrainGrid({ width, height }, (x, y) => {
    const startDistance = Math.min(...bases.map((base) => Math.hypot(x - base.x, y - base.y)));
    if (startDistance < 3.5) return "basalt";
    if (startDistance < 4.5) return "ash";

    const dx = (x - (width - 1) / 2) / (width * 0.48),
      dy = (y - (height - 1) / 2) / (height * 0.48);
    const normalizedRadius = Math.hypot(dx, dy),
      angle = Math.atan2(dy, dx);
    const hazard = volcanicHazard(normalizedRadius, angle, phase);
    if (hazard) return hazard;

    return random() < roughness * 1.8 ? "ash" : "basalt";
  });
};

export const volcanic: BiomeTemplate = {
  generateTerrain: generateVolcanicTerrain,
  connectTerrain: connectGeneratedLand,
};

function volcanicHazard(normalizedRadius: number, angle: number, phase: number): Terrain | null {
  const causeway = Math.abs(Math.sin(angle * 3 + phase)) < 0.18;

  const insideCrater = normalizedRadius < 0.23;
  const insideLavaRing = normalizedRadius > 0.5 && normalizedRadius < 0.66;
  const exposedLavaRing = insideLavaRing && !causeway;
  const inLavaCaldera = insideCrater || exposedLavaRing;
  if (inLavaCaldera) return "lava";

  const insideFlowRange = normalizedRadius > 0.24 && normalizedRadius < 0.95;
  const insideFlowChannel = Math.abs(Math.sin(angle * 3 + phase + 1)) < 0.12;
  const inRadialLavaFlow = insideFlowRange && insideFlowChannel;
  if (inRadialLavaFlow) return "lava";

  const insideInnerRim = normalizedRadius < 0.32;
  const insideOuterRim = normalizedRadius > 0.66 && normalizedRadius < 0.78;
  const onCalderaRim = insideInnerRim || insideOuterRim;
  if (onCalderaRim) return "mountain";

  return null;
}
