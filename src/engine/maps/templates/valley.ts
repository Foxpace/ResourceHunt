import type { TerrainGenerator, BiomeTemplate } from "../generation-models.ts";
import { connectGeneratedLand } from "../map-connectivity.ts";
import type { Position } from "../../types.ts";
import { createTerrainGrid } from "../terrain-tools.ts";

const generateValleyTerrain: TerrainGenerator = ({ width, height, roughness, random, bases }) => {
  const center = { x: (width - 1) / 2, y: (height - 1) / 2 };
  const phase = random() * Math.PI * 2;
  const floor = Math.max(0.65, Math.min(2, Math.min(width, height) / (bases.length * 2.5)));
  const branches = bases.map((base) => {
    const length = Math.hypot(base.x - center.x, base.y - center.y);

    return { x: (base.x - center.x) / length, y: (base.y - center.y) / length, length };
  });

  return createTerrainGrid({ width, height }, (x, y) => {
    const dx = x - center.x,
      dy = y - center.y;
    const distance = Math.min(
      ...branches.map((branch) => valleyBranchDistance({ x: dx, y: dy }, branch, { phase, floor })),
    );

    if (Math.hypot(dx, dy) < floor * 2) return "grass";
    if (distance <= floor) return "grass";

    const pass = Math.abs(Math.sin(Math.hypot(dx, dy) / 4 + phase)) < 0.12;
    if (distance <= floor + 1.1) return pass ? "mountain" : "cliff";

    return random() < roughness ? "forest" : "mountain";
  });
};

export const valley: BiomeTemplate = {
  generateTerrain: generateValleyTerrain,
  connectTerrain: connectGeneratedLand,
};

interface ValleyBranch extends Position {
  length: number;
}

function valleyBranchDistance(
  offset: Position,
  branch: ValleyBranch,
  shape: { phase: number; floor: number },
): number {
  const { x: dx, y: dy } = offset;
  const { phase, floor } = shape;
  const along = dx * branch.x + dy * branch.y;
  if (along < 0) return Infinity;

  const wave =
    Math.sin((along / branch.length) * Math.PI) * Math.sin(along / 5 + phase) * floor * 0.5;

  return Math.abs(dx * -branch.y + dy * branch.x - wave);
}
