import { createCanvasGrid, drawAtCell, type CanvasGrid } from "./canvas-grid.ts";
import { describeMapCell } from "../model/map-description.ts";
import type { Position, Snapshot } from "../../engine/types.ts";

import { drawCachedTerrain, releaseTerrainCache } from "./terrain-cache.ts";
import { WorldOverlays } from "./world-overlays.ts";
import { drawMapEffects } from "./map-effects.ts";
import { BoardSites } from "./board-sites.ts";
import { BoardUnits } from "./board-units.ts";
import { drawLiquidMotion } from "./liquid-motion.ts";
import type { MapAnimation } from "../model/map-motion.ts";
export { releaseTerrainCache };

export interface MapScene {
  animation?: MapAnimation;
  hover?: Position;
}

export function drawMap(canvas: HTMLCanvasElement, state: Snapshot, scene: MapScene = {}) {
  const grid = prepareCanvasGrid(canvas, state);
  if (!grid) return;

  const { animation, hover } = scene;
  drawCachedTerrain(canvas, grid, state);
  drawLiquidMotion(grid, state, animation?.time ?? 0);
  const sites = new BoardSites(grid, state, animation?.time);
  for (const hotspot of state.hotspots) sites.drawHotspot(hotspot);
  for (const bot of state.bots) sites.drawBase(bot);
  for (const outpost of state.outposts) sites.drawOutpost(outpost);
  for (const resource of state.resources) sites.drawResource(resource);

  new WorldOverlays(grid, state, animation).draw();
  const units = new BoardUnits(grid, state, animation);
  for (const bot of state.bots) units.drawTrail(bot);
  if (hover) drawHoverCell(grid, hover);
  for (const bot of state.bots) units.drawBot(bot);

  drawMapEffects(grid, animation);
  if (hover) units.drawLabels(hover);
}

function prepareCanvasGrid(canvas: HTMLCanvasElement, state: Snapshot): CanvasGrid | undefined {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D rendering is unavailable");

  const rectangle = canvas.getBoundingClientRect();
  const pixelRatio = window.devicePixelRatio || 1;
  const width = Math.round(rectangle.width * pixelRatio);
  const height = Math.round(rectangle.height * pixelRatio);
  const hasSize = width > 0 && height > 0;
  if (!hasSize) return;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  return createCanvasGrid(context, {
    width: rectangle.width / state.map.width,
    height: rectangle.height / state.map.height,
  });
}

function drawHoverCell(grid: CanvasGrid, cell: Position): void {
  drawAtCell(grid, cell, (context) => {
    context.fillStyle = "#ffffff1c";
    context.strokeStyle = "#ffffffcc";
    context.lineWidth = 0.05;
    context.beginPath();
    context.roundRect(-0.47, -0.47, 0.94, 0.94, 0.14);
    context.fill();
    context.stroke();
  });
}

export function mapCellAt(canvas: HTMLCanvasElement, state: Snapshot, event: MouseEvent): Position {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.floor(((event.clientX - rect.left) / rect.width) * state.map.width),
    y: Math.floor(((event.clientY - rect.top) / rect.height) * state.map.height),
  };
}

export interface MapPointer {
  readonly canvas: HTMLCanvasElement;
  readonly tooltip: HTMLElement;
  readonly getSnapshot: () => Snapshot | undefined;
  readonly onHover: (cell?: Position) => void;
}

export function attachMapTooltip(pointer: MapPointer): () => void {
  const { canvas, tooltip } = pointer;
  const onMouseMove = mapTooltipHandler(pointer);
  const onMouseLeave = () => {
    tooltip.hidden = true;
    pointer.onHover(undefined);
  };
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseleave", onMouseLeave);

  return () => {
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseleave", onMouseLeave);
  };
}

function mapTooltipHandler(pointer: MapPointer) {
  const { canvas, tooltip } = pointer;
  return (event: MouseEvent) => {
    const state = pointer.getSnapshot();
    if (!state) return;

    const cell = mapCellAt(canvas, state, event);
    const description = describeMapCell(state, cell.x, cell.y);
    if (!description) return;

    pointer.onHover(cell);
    renderTooltip(tooltip, description);
    const rect = canvas.getBoundingClientRect();
    const left = event.clientX - rect.left + 16;
    const flip = left + tooltip.offsetWidth > rect.width;
    tooltip.style.left = `${flip ? left - tooltip.offsetWidth - 28 : left}px`;
    tooltip.style.top = `${Math.max(4, event.clientY - rect.top - 20)}px`;
  };
}

function renderTooltip(tooltip: HTMLElement, description: string): void {
  const [coordinates, terrain, ...details] = description.split(" · ");
  const title = document.createElement("strong");
  title.textContent = `${terrain ?? ""} `;
  const position = document.createElement("small");
  position.textContent = coordinates ?? "";
  title.append(position);
  const lines = details.map((detail) => {
    const line = document.createElement("span");
    line.textContent = detail;
    return line;
  });
  tooltip.replaceChildren(title, ...lines);
  tooltip.hidden = false;
}
