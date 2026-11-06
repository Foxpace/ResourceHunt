import type { MapDimensions } from "../../engine/grid.ts";
import type { Position } from "../../engine/types.ts";

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

/** Draws in unit space: the origin is the cell center and one unit is one cell. */
export function drawAtCell(
  grid: CanvasGrid,
  position: Position,
  draw: (context: CanvasRenderingContext2D) => void,
): void {
  const { context, cellWidth, cellHeight, cellSize } = grid;
  context.save();
  context.translate((position.x + 0.5) * cellWidth, (position.y + 0.5) * cellHeight);
  context.scale(cellSize, cellSize);
  draw(context);
  context.restore();
}

export function cellCenter(grid: CanvasGrid, position: Position): Position {
  return {
    x: (position.x + 0.5) * grid.cellWidth,
    y: (position.y + 0.5) * grid.cellHeight,
  };
}
