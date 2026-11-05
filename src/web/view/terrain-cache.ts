import type { Snapshot } from "../../engine/types.ts";
import { createCanvasGrid, type CanvasGrid } from "./canvas-grid.ts";
import { drawTerrain } from "./terrain.ts";

interface TerrainCache {
  map: Snapshot["map"];
  biome: Snapshot["config"]["biome"];
  bitmap: HTMLCanvasElement;
}
const terrainCaches = new WeakMap<HTMLCanvasElement, TerrainCache>();

export function drawCachedTerrain(
  canvas: HTMLCanvasElement,
  grid: CanvasGrid,
  state: Snapshot,
): void {
  const cached = terrainCaches.get(canvas);
  const sameSize = cached?.bitmap.width === canvas.width && cached?.bitmap.height === canvas.height;
  const sameTerrain = cached?.map === state.map && cached?.biome === state.config.biome;
  if (!sameSize || !sameTerrain) terrainCaches.set(canvas, rasterizeTerrain(canvas, state));

  const bitmap = terrainCaches.get(canvas)!.bitmap;
  grid.context.drawImage(
    bitmap,
    0,
    0,
    grid.cellWidth * state.map.width,
    grid.cellHeight * state.map.height,
  );
}

function rasterizeTerrain(canvas: HTMLCanvasElement, state: Snapshot): TerrainCache {
  const bitmap = document.createElement("canvas");
  bitmap.width = canvas.width;
  bitmap.height = canvas.height;
  const context = bitmap.getContext("2d")!;
  const grid = createCanvasGrid(context, {
    width: bitmap.width / state.map.width,
    height: bitmap.height / state.map.height,
  });
  drawTerrain(grid, state.map, state.config.biome);

  return { map: state.map, biome: state.config.biome, bitmap };
}

export function releaseTerrainCache(canvas: HTMLCanvasElement): void {
  terrainCaches.delete(canvas);
}
