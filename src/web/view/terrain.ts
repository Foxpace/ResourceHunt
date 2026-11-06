import type { CanvasGrid } from "./canvas-grid.ts";
import type { Biome, GameMap, Position } from "../../engine/types.ts";
import { BIOMES } from "../../engine/biomes.ts";
import { drawGroundGlyph } from "./terrain-glyphs.ts";
import { terrainSwatch, tileNoise } from "./terrain-palette.ts";
import {
  drawBridgeDeck,
  drawCanopy,
  drawCastShadow,
  drawRaisedTerrain,
  drawShoreline,
  inUnitTile,
  terrainAt,
  type TerrainScene,
} from "./terrain-relief.ts";

type TilePass = (scene: TerrainScene, position: Position) => void;

/** Paints terrain in layered passes: ground, water edges, shadows, canopy, relief, bridges. */
export function drawTerrain(grid: CanvasGrid, map: GameMap, biome: Biome) {
  const scene = { grid, map, biome };
  const passes: TilePass[] = [
    drawGroundTile,
    drawShoreline,
    drawCastShadow,
    drawCanopy,
    drawRaisedTerrain,
    drawBridgeDeck,
  ];

  for (const pass of passes) forEachTile(scene, pass);
  drawGridLines(scene);
  drawVignette(scene);
}

function forEachTile(scene: TerrainScene, pass: TilePass): void {
  for (let y = 0; y < scene.map.height; y++)
    for (let x = 0; x < scene.map.width; x++) pass(scene, { x, y });
}

function drawGroundTile(scene: TerrainScene, position: Position): void {
  const { context, cellWidth, cellHeight } = scene.grid;
  const terrain = terrainAt(scene, position)!;
  const ground = terrain === "mountain" ? BIOMES[scene.biome].spawnTerrain : terrain;
  const [base] = terrainSwatch(ground, scene.biome);
  const left = position.x * cellWidth;
  const top = position.y * cellHeight;
  context.fillStyle = base;
  context.fillRect(left, top, cellWidth + 0.5, cellHeight + 0.5);

  const shade = tileNoise(position.x, position.y) - 0.5;
  context.fillStyle =
    shade > 0 ? `rgba(255,255,255,${shade * 0.07})` : `rgba(0,0,0,${-shade * 0.1})`;
  context.fillRect(left, top, cellWidth + 0.5, cellHeight + 0.5);

  inUnitTile(scene, position, drawGroundGlyph);
}

function drawGridLines(scene: TerrainScene): void {
  const { context, cellWidth, cellHeight } = scene.grid;
  const { width, height } = scene.map;
  context.strokeStyle = "rgba(0,0,0,0.13)";
  context.lineWidth = 1;
  context.beginPath();
  for (let x = 1; x < width; x++) {
    context.moveTo(Math.round(x * cellWidth) + 0.5, 0);
    context.lineTo(Math.round(x * cellWidth) + 0.5, height * cellHeight);
  }
  for (let y = 1; y < height; y++) {
    context.moveTo(0, Math.round(y * cellHeight) + 0.5);
    context.lineTo(width * cellWidth, Math.round(y * cellHeight) + 0.5);
  }
  context.stroke();
}

function drawVignette(scene: TerrainScene): void {
  const { context, cellWidth, cellHeight } = scene.grid;
  const width = scene.map.width * cellWidth;
  const height = scene.map.height * cellHeight;
  const radius = Math.hypot(width, height) / 2;
  const light = context.createRadialGradient(
    width * 0.45,
    height * 0.4,
    radius * 0.35,
    width / 2,
    height / 2,
    radius,
  );
  light.addColorStop(0, "rgba(255,244,214,0.04)");
  light.addColorStop(1, "rgba(3,10,14,0.42)");
  context.fillStyle = light;
  context.fillRect(0, 0, width, height);
}
