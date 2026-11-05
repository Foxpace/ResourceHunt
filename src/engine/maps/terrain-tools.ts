import type { MapDimensions } from "../grid.ts";
import type { Position, Terrain } from "../types.ts";

export function createTerrainGrid(
  dimensions: MapDimensions,
  terrainAt: (x: number, y: number) => Terrain,
): Terrain[][] {
  return Array.from({ length: dimensions.height }, (_, y) =>
    Array.from({ length: dimensions.width }, (_, x) => terrainAt(x, y)),
  );
}

export interface Ellipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

export function createEllipse(
  random: () => number,
  dimensions: MapDimensions,
  scale: number,
): Ellipse {
  const { width, height } = dimensions;

  return {
    x: (0.15 + random() * 0.7) * (width - 1),
    y: (0.15 + random() * 0.7) * (height - 1),
    rx: Math.max(2, width * scale * (0.7 + random() * 0.6)),
    ry: Math.max(2, height * scale * (0.7 + random() * 0.6)),
  };
}

export function ellipseRadius(position: Position, shape: Ellipse): number {
  return Math.hypot((position.x - shape.x) / shape.rx, (position.y - shape.y) / shape.ry);
}
