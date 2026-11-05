import type { GameMap, Position } from "./types.ts";

export interface MapDimensions {
  width: number;
  height: number;
}

export interface CellBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Row-major iteration preserves seeded generation order. Bounds are inclusive. */
export function* cellsInRectangle(bounds: CellBounds): Generator<Position> {
  const { left, top, right, bottom } = bounds;

  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) yield { x, y };
}

export function mapCells(map: Pick<GameMap, "width" | "height">, inset = 0): Generator<Position> {
  return cellsInRectangle({
    left: inset,
    top: inset,
    right: map.width - 1 - inset,
    bottom: map.height - 1 - inset,
  });
}

export function manhattanDistance(first: Position, second: Position): number {
  return Math.abs(first.x - second.x) + Math.abs(first.y - second.y);
}
