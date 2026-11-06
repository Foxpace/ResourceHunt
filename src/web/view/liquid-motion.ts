import { mapCells } from "../../engine/grid.ts";
import type { Snapshot } from "../../engine/types.ts";
import { drawAtCell, type CanvasGrid } from "./canvas-grid.ts";
import { tileNoise } from "./terrain-palette.ts";

/** Live shimmer on water and a slow glow on lava, drawn over the cached terrain. */
export function drawLiquidMotion(grid: CanvasGrid, state: Snapshot, time: number): void {
  if (!time) return;

  for (const { x, y } of mapCells(state.map)) {
    const terrain = state.map.tiles[y]![x];
    if (terrain === "water") drawWaterGlint(grid, { x, y, time });
    else if (terrain === "lava") drawLavaPulse(grid, { x, y, time });
  }
}

interface LiquidCell {
  x: number;
  y: number;
  time: number;
}

function drawWaterGlint(grid: CanvasGrid, cell: LiquidCell): void {
  const seed = tileNoise(cell.x, cell.y, 90);
  if (seed < 0.55) return;

  const phase = (cell.time * 0.35 + seed * 7) % 1;
  drawAtCell(grid, cell, (context) => {
    context.globalAlpha = Math.sin(phase * Math.PI) * 0.45;
    context.strokeStyle = "#d9f6ff";
    context.lineWidth = 0.04;
    context.lineCap = "round";
    context.beginPath();
    const x = -0.3 + phase * 0.5;
    const y = (tileNoise(cell.x, cell.y, 91) - 0.5) * 0.6;
    context.moveTo(x, y);
    context.lineTo(x + 0.16, y);
    context.stroke();
  });
}

function drawLavaPulse(grid: CanvasGrid, cell: LiquidCell): void {
  const seed = tileNoise(cell.x, cell.y, 92);
  const glow = (Math.sin(cell.time * 1.6 + seed * 6.3) + 1) / 2;
  drawAtCell(grid, cell, (context) => {
    context.fillStyle = `rgba(255, 196, 92, ${0.05 + glow * 0.16})`;
    context.fillRect(-0.5, -0.5, 1, 1);
  });
}
