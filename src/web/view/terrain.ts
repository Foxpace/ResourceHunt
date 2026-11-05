import type { CanvasGrid } from "./canvas-grid.ts";
import {
  TERRAIN_COST,
  type Biome,
  type GameMap,
  type Terrain,
  type Position,
} from "../../engine/types.ts";

type Swatch = readonly [base: string, detail: string];
const colors: Record<Terrain, Swatch> = {
  grass: ["#2c412d", "#425b37"],
  forest: ["#223b29", "#506f43"],
  mountain: ["#3e493b", "#88937b"],
  water: ["#24515e", "#568b98"],
  bridge: ["#24515e", "#baa273"],
  sand: ["#ba8b50", "#dcb77c"],
  dune: ["#9e6d3d", "#d1a260"],
  oasis: ["#526b4a", "#9bb57a"],
  regolith: ["#51566b", "#71788f"],
  crater: ["#383d50", "#68708a"],
  cliff: ["#292d35", "#6b7081"],
  basalt: ["#353237", "#50434a"],
  ash: ["#5f5051", "#897071"],
  lava: ["#b43e24", "#ffac4a"],
  snow: ["#b0c8d4", "#e4eff1"],
  ice: ["#6eabbf", "#b0dce7"],
  thicket: ["#162d23", "#304d34"],
};
const themes: Partial<Record<Biome, Partial<Record<Terrain, Swatch>>>> = {
  valley: {
    grass: ["#4c6040", "#738257"],
    mountain: ["#5c5349", "#9d927b"],
    cliff: ["#342e2b", "#776753"],
  },
  desert: {
    mountain: ["#7b5038", "#c29264"],
    cliff: ["#553b30", "#997052"],
    water: ["#2f7777", "#69b5a2"],
  },
  moon: { mountain: ["#626779", "#a2a7b9"], cliff: ["#252938", "#626b83"] },
  volcanic: { mountain: ["#43383e", "#856970"], cliff: ["#29252c", "#66525c"] },
  archipelago: {
    grass: ["#3a6847", "#58875a"],
    water: ["#23576b", "#438899"],
    bridge: ["#23576b", "#ccb58a"],
  },
  tundra: { mountain: ["#688390", "#deebee"], water: ["#294b66", "#52829f"] },
  forest: { grass: ["#42523a", "#65744c"], forest: ["#2a4230", "#5b754b"] },
};

/** Theme colors and terrain glyphs live together, independent of game overlays. */
export function drawTerrain(grid: CanvasGrid, map: GameMap, biome: Biome) {
  const painter = new TerrainPainter(grid, map, biome);

  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) painter.drawTile({ x, y });
}

class TerrainPainter {
  constructor(
    private grid: CanvasGrid,
    private map: GameMap,
    private biome: Biome,
  ) {}

  drawTile(position: Position): void {
    const { context, cellWidth, cellHeight, cellSize } = this.grid;
    const { map, biome } = this;
    const { x, y } = position;

    const terrain = map.tiles[y]![x]!;
    const [base, detail] = themes[biome]?.[terrain] ?? colors[terrain];
    context.fillStyle = base;
    context.fillRect(x * cellWidth, y * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
    context.fillStyle = (x * 7 + y * 13 + x * y) % 3 ? "#ffffff04" : "#00000007";
    context.fillRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);
    context.strokeStyle = "#08111824";
    context.lineWidth = 0.5;
    context.strokeRect(x * cellWidth, y * cellHeight, cellWidth, cellHeight);

    context.save();
    context.translate((x + 0.5) * cellWidth, (y + 0.5) * cellHeight);
    context.scale(cellSize, cellSize);
    context.fillStyle = detail;
    context.strokeStyle = detail;
    context.lineWidth = 0.04;
    drawTerrainGlyph(context, terrain, position);
    context.restore();

    if (terrain === "bridge") this.drawBridge(position, detail);
  }

  private drawBridge(position: Position, color: string): void {
    const { context, cellWidth, cellHeight } = this.grid;
    const { x, y } = position;
    const centerX = (x + 0.5) * cellWidth,
      centerY = (y + 0.5) * cellHeight;
    context.fillStyle = color;
    context.fillRect(
      centerX - cellWidth * 0.25,
      centerY - cellHeight * 0.25,
      cellWidth * 0.5,
      cellHeight * 0.5,
    );

    // Join real neighboring land/decks, including north/south crossings and corners.
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ]) {
      this.drawBridgeConnection(position, { x: dx!, y: dy! });
    }
  }

  private drawBridgeConnection(position: Position, delta: Position): void {
    const { context, cellWidth, cellHeight } = this.grid;
    const { map } = this;
    const { x, y } = position;
    const { x: dx, y: dy } = delta;

    const centerX = (x + 0.5) * cellWidth,
      centerY = (y + 0.5) * cellHeight;
    const tile = map.tiles[y + dy!]?.[x + dx!];

    const neighborBlocked = !tile || !Number.isFinite(TERRAIN_COST[tile]);
    if (neighborBlocked) return;

    context.fillRect(
      centerX + (dx! < 0 ? -cellWidth * 0.5 : -cellWidth * 0.25),
      centerY + (dy! < 0 ? -cellHeight * 0.5 : -cellHeight * 0.25),
      cellWidth * (dx ? 0.75 : 0.5),
      cellHeight * (dy ? 0.75 : 0.5),
    );
    this.drawBridgeRailing({ x: centerX, y: centerY }, delta);
  }

  private drawBridgeRailing(center: Position, delta: Position): void {
    const { context, cellWidth, cellHeight } = this.grid;
    const { x: centerX, y: centerY } = center;
    const { x: dx, y: dy } = delta;

    context.strokeStyle = "#534a3a";
    context.lineWidth = 0.7;
    context.beginPath();
    if (dx) {
      context.moveTo(centerX + dx * cellWidth * 0.3, centerY - cellHeight * 0.25);
      context.lineTo(centerX + dx * cellWidth * 0.3, centerY + cellHeight * 0.25);
    } else {
      context.moveTo(centerX - cellWidth * 0.25, centerY + dy! * cellHeight * 0.3);
      context.lineTo(centerX + cellWidth * 0.25, centerY + dy! * cellHeight * 0.3);
    }

    context.stroke();
  }
}

function drawLine(context: CanvasRenderingContext2D, points: number[][]) {
  context.beginPath();

  for (const [index, point] of points.entries())
    index ? context.lineTo(point[0]!, point[1]!) : context.moveTo(point[0]!, point[1]!);

  context.stroke();
}

function drawTerrainGlyph(context: CanvasRenderingContext2D, terrain: Terrain, position: Position) {
  if (terrain === "mountain") return drawMountain(context);

  const treeTerrain = terrain === "forest" || terrain === "thicket";
  if (treeTerrain) return drawTrees(context);
  if (terrain === "cliff") return drawCliff(context);
  if (terrain === "crater") return drawCrater(context);

  const sandyTerrain = terrain === "dune" || terrain === "sand";
  if (sandyTerrain) return drawDunes(context, terrain, position);
  if (terrain === "oasis") return drawOasis(context);

  const crackedTerrain = terrain === "lava" || terrain === "ice";
  if (crackedTerrain) return drawCracks(context);
  if (terrain === "snow") return drawSnow(context, position);
  if (terrain === "water") return drawWater(context);

  const rockyTerrain = terrain === "regolith" || terrain === "basalt" || terrain === "ash";
  if (rockyTerrain) return drawRocks(context);
}

function drawMountain(context: CanvasRenderingContext2D) {
  context.beginPath();
  context.moveTo(0, -0.32);
  context.lineTo(-0.34, 0.25);
  context.lineTo(0.34, 0.25);
  context.fill();
  drawLine(context, [
    [0, -0.26],
    [0.08, 0.03],
    [0.25, 0.19],
  ]);
}

function drawTrees(context: CanvasRenderingContext2D) {
  for (const dx of [-0.17, 0.17]) {
    context.beginPath();
    context.moveTo(dx, -0.33);
    context.lineTo(dx - 0.18, 0.21);
    context.lineTo(dx + 0.18, 0.21);
    context.fill();
  }
}

function drawCliff(context: CanvasRenderingContext2D) {
  drawLine(context, [
    [-0.42, 0.29],
    [-0.18, -0.24],
    [0.06, 0.15],
    [0.25, -0.27],
    [0.42, 0.2],
  ]);
  drawLine(context, [
    [-0.18, -0.24],
    [-0.18, 0.36],
  ]);
}

function drawCrater(context: CanvasRenderingContext2D) {
  context.beginPath();
  context.ellipse(0, 0, 0.32, 0.24, -0.3, 0, Math.PI * 2);
  context.stroke();
  context.beginPath();
  context.arc(0.04, 0.02, 0.15, 0, Math.PI);
  context.stroke();
}

function drawDunes(context: CanvasRenderingContext2D, terrain: Terrain, position: Position) {
  const { x, y } = position;

  const showDuneGlyph = terrain === "dune" || (x + y) % 3 === 0;
  if (showDuneGlyph) {
    context.beginPath();
    context.moveTo(-0.4, 0.15);
    context.quadraticCurveTo(-0.05, -0.27, 0.4, -0.05);
    context.stroke();
    if (terrain === "dune")
      drawLine(context, [
        [-0.3, 0.32],
        [0.1, 0.16],
        [0.35, 0.18],
      ]);
  }
}

function drawOasis(context: CanvasRenderingContext2D) {
  drawLine(context, [
    [0, 0.3],
    [0.02, -0.15],
    [-0.27, -0.02],
  ]);
  drawLine(context, [
    [-0.25, -0.24],
    [0.02, -0.15],
    [0.3, -0.05],
  ]);
  drawLine(context, [
    [0.02, -0.15],
    [0.2, -0.3],
  ]);
}

function drawCracks(context: CanvasRenderingContext2D) {
  drawLine(context, [
    [-0.5, -0.2],
    [-0.18, 0.02],
    [0.1, -0.1],
    [0.5, 0.23],
  ]);
  drawLine(context, [
    [-0.18, 0.02],
    [-0.06, 0.45],
  ]);
}

function drawSnow(context: CanvasRenderingContext2D, position: Position) {
  const { x, y } = position;

  if ((x + y) % 3 === 0) {
    drawLine(context, [
      [-0.17, 0],
      [0.17, 0],
    ]);
    drawLine(context, [
      [0, -0.17],
      [0, 0.17],
    ]);
  }
}

function drawWater(context: CanvasRenderingContext2D) {
  drawLine(context, [
    [-0.28, 0.08],
    [0.22, 0.08],
  ]);
}

function drawRocks(context: CanvasRenderingContext2D) {
  context.fillRect(-0.2, 0.17, 0.06, 0.06);
  context.fillRect(0.19, -0.22, 0.05, 0.05);
}
