import type { Terrain } from "../../engine/types.ts";
import { tileNoise, type Swatch } from "./terrain-palette.ts";

/** One tile in unit space: the origin is the tile center and one unit is one cell. */
export interface UnitTile {
  readonly context: CanvasRenderingContext2D;
  readonly terrain: Terrain;
  readonly swatch: Swatch;
  readonly x: number;
  readonly y: number;
}

type GlyphPainter = (tile: UnitTile) => void;

const groundGlyphs: Partial<Record<Terrain, GlyphPainter>> = {
  grass: drawGrassTufts,
  forest: drawGrassTufts,
  sand: drawSandStipple,
  dune: drawDuneRidges,
  oasis: drawOasis,
  regolith: drawSmallCraters,
  crater: drawCraterBowl,
  basalt: drawBasaltColumns,
  ash: drawAshSpeckles,
  snow: drawSnowDrifts,
  ice: drawIceGloss,
  water: drawWaterRipples,
  bridge: drawWaterRipples,
  lava: drawLavaCracks,
};

export function drawGroundGlyph(tile: UnitTile): void {
  groundGlyphs[tile.terrain]?.(tile);
}

function noise(tile: UnitTile, salt: number): number {
  return tileNoise(tile.x, tile.y, salt);
}

function speckle(tile: UnitTile, options: { count: number; size: number; color: string }): void {
  const { context } = tile;
  context.fillStyle = options.color;
  for (let index = 0; index < options.count; index++) {
    const px = noise(tile, index * 2 + 1) - 0.5;
    const py = noise(tile, index * 2 + 2) - 0.5;
    context.fillRect(px * 0.86, py * 0.86, options.size, options.size);
  }
}

function drawGrassTufts(tile: UnitTile): void {
  const { context, swatch } = tile;
  if (noise(tile, 3) < 0.6) return;

  context.strokeStyle = `${swatch[1]}b0`;
  context.lineWidth = 0.045;
  context.lineCap = "round";
  const originX = (noise(tile, 4) - 0.5) * 0.5;
  const originY = (noise(tile, 5) - 0.5) * 0.5 + 0.1;
  context.beginPath();
  for (const lean of [-0.09, 0, 0.09]) {
    context.moveTo(originX + lean * 0.4, originY);
    context.lineTo(originX + lean, originY - 0.16 - Math.abs(lean));
  }
  context.stroke();
  if (noise(tile, 6) > 0.92) speckle(tile, { count: 2, size: 0.07, color: "#f1d67f" });
}

function drawSandStipple(tile: UnitTile): void {
  speckle(tile, { count: 5, size: 0.04, color: `${tile.swatch[1]}cc` });
  speckle(tile, { count: 2, size: 0.04, color: "#7a552a55" });
}

function drawDuneRidges(tile: UnitTile): void {
  const { context, swatch } = tile;
  const shift = (noise(tile, 7) - 0.5) * 0.2;
  context.lineWidth = 0.07;
  context.lineCap = "round";
  for (const row of [-0.18, 0.2]) {
    context.strokeStyle = "#00000022";
    context.beginPath();
    context.moveTo(-0.46, row + shift + 0.06);
    context.quadraticCurveTo(0, row + shift - 0.16, 0.46, row + shift + 0.06);
    context.stroke();
    context.strokeStyle = swatch[1];
    context.beginPath();
    context.moveTo(-0.46, row + shift);
    context.quadraticCurveTo(0, row + shift - 0.22, 0.46, row + shift);
    context.stroke();
  }
}

function drawOasis(tile: UnitTile): void {
  const { context, swatch } = tile;
  context.fillStyle = "#3b8f8a";
  context.beginPath();
  context.ellipse(0.12, 0.2, 0.22, 0.12, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = "#5b3f22";
  context.lineWidth = 0.05;
  context.beginPath();
  context.moveTo(-0.12, 0.3);
  context.quadraticCurveTo(-0.08, 0, -0.16, -0.18);
  context.stroke();
  context.fillStyle = swatch[1];
  for (const angle of [-2.6, -1.9, -1.2, -0.5]) {
    context.beginPath();
    context.ellipse(
      -0.16 + Math.cos(angle) * 0.14,
      -0.18 + Math.sin(angle) * 0.08,
      0.16,
      0.05,
      angle,
      0,
      Math.PI * 2,
    );
    context.fill();
  }
}

function drawSmallCraters(tile: UnitTile): void {
  const { context, swatch } = tile;
  speckle(tile, { count: 3, size: 0.04, color: `${swatch[1]}aa` });
  if (noise(tile, 8) < 0.6) return;

  const cx = (noise(tile, 9) - 0.5) * 0.4;
  const cy = (noise(tile, 10) - 0.5) * 0.4;
  context.strokeStyle = swatch[1];
  context.lineWidth = 0.04;
  context.beginPath();
  context.arc(cx, cy, 0.12, Math.PI * 0.9, Math.PI * 2.1);
  context.stroke();
}

function drawCraterBowl(tile: UnitTile): void {
  const { context, swatch } = tile;
  const bowl = context.createRadialGradient(0.06, 0.08, 0.02, 0, 0, 0.4);
  bowl.addColorStop(0, "#00000055");
  bowl.addColorStop(1, "#00000000");
  context.fillStyle = bowl;
  context.beginPath();
  context.ellipse(0, 0, 0.38, 0.3, -0.2, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = swatch[1];
  context.lineWidth = 0.05;
  context.beginPath();
  context.ellipse(0, 0, 0.36, 0.28, -0.2, Math.PI * 1.05, Math.PI * 1.95);
  context.stroke();
}

function drawBasaltColumns(tile: UnitTile): void {
  const { context, swatch } = tile;
  context.strokeStyle = `${swatch[1]}aa`;
  context.lineWidth = 0.03;
  context.beginPath();
  for (let index = 0; index < 6; index++) {
    const angle = (index * Math.PI) / 3 + noise(tile, 11);
    context.lineTo(Math.cos(angle) * 0.24, Math.sin(angle) * 0.24);
  }
  context.closePath();
  context.stroke();
}

function drawAshSpeckles(tile: UnitTile): void {
  speckle(tile, { count: 4, size: 0.05, color: `${tile.swatch[1]}bb` });
  if (noise(tile, 12) > 0.85) speckle(tile, { count: 1, size: 0.07, color: "#ff9b52" });
}

function drawSnowDrifts(tile: UnitTile): void {
  const { context } = tile;
  speckle(tile, { count: 3, size: 0.05, color: "#ffffffcc" });
  context.strokeStyle = "#7d9fb455";
  context.lineWidth = 0.05;
  context.beginPath();
  const offset = (noise(tile, 13) - 0.5) * 0.4;
  context.moveTo(-0.35, offset + 0.2);
  context.quadraticCurveTo(0, offset + 0.05, 0.35, offset + 0.22);
  context.stroke();
}

function drawIceGloss(tile: UnitTile): void {
  const { context } = tile;
  context.strokeStyle = "#ffffff55";
  context.lineWidth = 0.05;
  context.beginPath();
  context.moveTo(-0.3, 0.2);
  context.lineTo(0.05, -0.3);
  if (noise(tile, 14) > 0.5) {
    context.moveTo(-0.05, 0.32);
    context.lineTo(0.2, -0.04);
  }
  context.stroke();
}

function drawWaterRipples(tile: UnitTile): void {
  const { context, swatch } = tile;
  if (noise(tile, 15) < 0.5) return;

  const cx = (noise(tile, 16) - 0.5) * 0.4;
  const cy = (noise(tile, 17) - 0.5) * 0.5;
  context.strokeStyle = `${swatch[1]}88`;
  context.lineWidth = 0.045;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(cx - 0.18, cy);
  context.quadraticCurveTo(cx - 0.09, cy - 0.07, cx, cy);
  context.quadraticCurveTo(cx + 0.09, cy + 0.07, cx + 0.18, cy);
  context.stroke();
}

function drawLavaCracks(tile: UnitTile): void {
  const { context, swatch } = tile;
  const tilt = noise(tile, 18) * Math.PI;
  context.rotate(tilt);
  context.strokeStyle = swatch[1];
  context.lineWidth = 0.07;
  context.lineCap = "round";
  context.beginPath();
  context.moveTo(-0.42, -0.1);
  context.lineTo(-0.12, 0.04);
  context.lineTo(0.1, -0.08);
  context.lineTo(0.42, 0.14);
  context.moveTo(-0.12, 0.04);
  context.lineTo(-0.04, 0.38);
  context.stroke();
}
