import type { MapDimensions } from "../../engine/grid.ts";

/** Pixel dimensions shared by terrain and map overlays. */
export interface CanvasGrid {
  readonly context: CanvasRenderingContext2D;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly cellSize: number;
}

export function createCanvasGrid(
  context: CanvasRenderingContext2D,
  cell: MapDimensions,
): CanvasGrid {
  return {
    context,
    cellWidth: cell.width,
    cellHeight: cell.height,
    cellSize: Math.min(cell.width, cell.height),
  };
}
