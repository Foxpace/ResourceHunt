import { createCanvasGrid, type CanvasGrid } from "./canvas-grid.ts";
import { describeMapCell } from "../model/map-description.ts";
import { samePosition } from "../../engine/pathfinding.ts";
import {
  RESOURCES,
  type BotState,
  type Hotspot,
  type Outpost,
  type ResourcePile,
  type Snapshot,
  type Position,
} from "../../engine/types.ts";

import { drawCachedTerrain, releaseTerrainCache } from "./terrain-cache.ts";
import { WorldOverlays } from "./world-overlays.ts";
import { drawMapEffects } from "./map-effects.ts";
import { animatedBotPosition, type MapAnimation } from "../model/map-motion.ts";
export { releaseTerrainCache };

export function drawMap(canvas: HTMLCanvasElement, state: Snapshot, animation?: MapAnimation) {
  const grid = prepareCanvasGrid(canvas, state);
  if (!grid) return;
  drawCachedTerrain(canvas, grid, state);
  const overlays = new MapOverlays(grid, state, animation);
  for (const hotspot of state.hotspots) overlays.drawHotspot(hotspot);
  for (const outpost of state.outposts) overlays.drawOutpost(outpost);
  for (const resource of state.resources) overlays.drawResource(resource);
  for (const bot of state.bots) overlays.drawBase(bot);

  new WorldOverlays(grid, state, animation).draw();
  for (const bot of state.bots) overlays.drawBot(bot);

  drawMapEffects(grid, animation);
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

class MapOverlays {
  constructor(
    private grid: CanvasGrid,
    private state: Snapshot,
    private animation?: MapAnimation,
  ) {}

  private get context() {
    return this.grid.context;
  }
  private get cellWidth() {
    return this.grid.cellWidth;
  }
  private get cellHeight() {
    return this.grid.cellHeight;
  }
  private get cellSize() {
    return this.grid.cellSize;
  }

  drawHotspot(hotspot: Hotspot): void {
    const centerX = (hotspot.x + 0.5) * this.cellWidth,
      centerY = (hotspot.y + 0.5) * this.cellHeight;
    const radius = hotspot.radius + 0.55;
    this.context.save();
    this.context.strokeStyle = "#e3ca7880";
    this.context.fillStyle = "#e3ca780c";
    this.context.setLineDash([3, 4]);
    this.context.lineWidth = 1;
    this.context.beginPath();
    this.context.moveTo(centerX, centerY - radius * this.cellHeight);
    this.context.lineTo(centerX + radius * this.cellWidth, centerY);
    this.context.lineTo(centerX, centerY + radius * this.cellHeight);
    this.context.lineTo(centerX - radius * this.cellWidth, centerY);
    this.context.closePath();
    this.context.fill();
    this.context.stroke();
    this.context.restore();
  }

  drawOutpost(post: Outpost): void {
    const centerX = (post.x + 0.5) * this.cellWidth,
      centerY = (post.y + 0.5) * this.cellHeight;
    const owner = this.state.bots.find((bot) => bot.id === post.ownerId);
    const capturer = this.state.bots.find((bot) => bot.id === post.capturingBotId);
    this.context.fillStyle = "#102016";
    this.context.fillRect(
      centerX - this.cellSize * 0.43,
      centerY - this.cellSize * 0.43,
      this.cellSize * 0.86,
      this.cellSize * 0.86,
    );
    this.context.strokeStyle = owner?.color ?? "#c9d4c1";
    this.context.lineWidth = 1.4;
    this.context.strokeRect(
      centerX - this.cellSize * 0.4,
      centerY - this.cellSize * 0.4,
      this.cellSize * 0.8,
      this.cellSize * 0.8,
    );
    this.drawOutpostFlag(centerX, centerY, owner?.color ?? "#c9d4c1");
    if (capturer) this.drawCaptureProgress(post, capturer, { x: centerX, y: centerY });
  }

  private drawOutpostFlag(centerX: number, centerY: number, color: string): void {
    this.context.beginPath();
    this.context.moveTo(centerX - this.cellSize * 0.15, centerY + this.cellSize * 0.27);
    this.context.lineTo(centerX - this.cellSize * 0.15, centerY - this.cellSize * 0.27);
    this.context.stroke();
    this.context.fillStyle = color;
    this.context.beginPath();
    this.context.moveTo(centerX - this.cellSize * 0.15, centerY - this.cellSize * 0.27);
    this.context.lineTo(centerX + this.cellSize * 0.3, centerY - this.cellSize * 0.1);
    this.context.lineTo(centerX - this.cellSize * 0.15, centerY + this.cellSize * 0.05);
    this.context.fill();
  }

  drawResource(pile: ResourcePile): void {
    const x = (pile.x + 0.5) * this.cellWidth,
      y = (pile.y + 0.5) * this.cellHeight,
      radius = this.cellSize * 0.2;
    this.context.fillStyle = "#112018aa";
    this.context.beginPath();
    this.context.arc(x, y, radius * 1.6, 0, Math.PI * 2);
    this.context.fill();
    this.context.fillStyle = RESOURCES[pile.kind].color;
    this.drawResourceGlyph(pile, { x, y }, radius);
  }

  drawBase(bot: BotState): void {
    const x = bot.base.x * this.cellWidth,
      y = bot.base.y * this.cellHeight;
    this.context.fillStyle = bot.color + "33";
    this.context.fillRect(
      x - this.cellWidth * 0.1,
      y - this.cellHeight * 0.1,
      this.cellWidth * 1.2,
      this.cellHeight * 1.2,
    );
    this.context.strokeStyle = bot.color;
    this.context.lineWidth = 1.3;
    this.context.strokeRect(x + 0.5, y + 0.5, this.cellWidth - 1, this.cellHeight - 1);
    this.context.fillStyle = bot.color;
    this.context.font = `bold ${this.cellSize * 0.65}px monospace`;
    this.context.textAlign = "center";
    this.context.textBaseline = "middle";
    this.context.fillText("⌂", x + this.cellWidth * 0.5, y + this.cellHeight * 0.52);
  }

  drawBot(bot: BotState): void {
    const collocated = this.state.bots.filter((other) =>
      samePosition(other.position, bot.position),
    );
    const offset =
      collocated.length > 1
        ? (collocated.indexOf(bot) - (collocated.length - 1) / 2) * this.cellSize * 0.27
        : 0;
    const position = animatedBotPosition(bot, this.animation);
    const x = (position.x + 0.5) * this.cellWidth + offset,
      y = (position.y + 0.5) * this.cellHeight;
    this.drawBotBody(bot, { x, y });
  }

  private drawBotBody(bot: BotState, position: Position): void {
    const { x, y } = position;
    this.context.save();
    this.context.shadowColor = bot.color;
    this.context.shadowBlur = bot.disabled ? 0 : 9;
    this.context.fillStyle = "#0e1c12";
    this.context.beginPath();
    this.context.arc(x, y + 1, this.cellSize * 0.43, 0, Math.PI * 2);
    this.context.fill();
    this.context.fillStyle = bot.disabled ? "#63715e" : bot.color;
    this.context.beginPath();
    this.context.arc(x, y, this.cellSize * 0.33, 0, Math.PI * 2);
    this.context.fill();
    this.context.fillStyle = "#1b281f";
    this.context.fillRect(
      x - this.cellSize * 0.17,
      y - this.cellSize * 0.08,
      this.cellSize * 0.34,
      this.cellSize * 0.14,
    );
    this.context.shadowBlur = 0;
    this.drawBotBadges(bot, x, y);
    this.context.restore();
  }

  private drawCaptureProgress(post: Outpost, capturer: BotState, center: Position): void {
    const { x: centerX, y: centerY } = center;

    this.context.strokeStyle = capturer.color;
    this.context.lineWidth = 2;
    this.context.beginPath();
    this.context.arc(
      centerX,
      centerY,
      this.cellSize * 0.5,
      -Math.PI / 2,
      -Math.PI / 2 + (Math.PI * 2 * post.captureProgress) / this.state.config.captureTurns,
    );
    this.context.stroke();
  }

  private drawResourceGlyph(pile: ResourcePile, center: Position, radius: number): void {
    const { x, y } = center;

    if (pile.kind === "ore") {
      this.context.beginPath();
      this.context.arc(x, y, radius, 0, Math.PI * 2);
      this.context.fill();
    } else {
      this.context.beginPath();
      this.context.moveTo(x, y - radius * 1.4);
      this.context.lineTo(x + radius, y);
      this.context.lineTo(x, y + radius * 1.4);
      this.context.lineTo(x - radius, y);
      this.context.closePath();
      this.context.fill();
      if (pile.kind === "relic") {
        this.context.strokeStyle = "#f1e4ff";
        this.context.stroke();
      }
    }
  }

  private drawBotBadges(bot: BotState, x: number, y: number): void {
    if (bot.inventory.length) {
      this.context.fillStyle = "#f6f5d1";
      this.context.beginPath();
      this.context.arc(
        x + this.cellSize * 0.24,
        y - this.cellSize * 0.23,
        this.cellSize * 0.09,
        0,
        Math.PI * 2,
      );
      this.context.fill();
    }
    if (bot.theftProtectedUntilTick > this.state.tick) {
      this.context.strokeStyle = "#f0f5d280";
      this.context.lineWidth = 1;
      this.context.beginPath();
      this.context.arc(x, y, this.cellSize * 0.44, 0, Math.PI * 2);
      this.context.stroke();
    }
  }
}

export function attachMapTooltip(
  canvas: HTMLCanvasElement,
  tooltip: HTMLElement,
  getSnapshot: () => Snapshot | undefined,
): () => void {
  const onMouseMove = mapTooltipHandler(canvas, tooltip, getSnapshot);
  const onMouseLeave = () => {
    tooltip.hidden = true;
  };
  canvas.addEventListener("mousemove", onMouseMove);
  canvas.addEventListener("mouseleave", onMouseLeave);

  return () => {
    canvas.removeEventListener("mousemove", onMouseMove);
    canvas.removeEventListener("mouseleave", onMouseLeave);
  };
}

function mapTooltipHandler(
  canvas: HTMLCanvasElement,
  tooltip: HTMLElement,
  getSnapshot: () => Snapshot | undefined,
) {
  return (event: MouseEvent) => {
    const state = getSnapshot();
    if (!state) return;

    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.map.width),
      y = Math.floor(((event.clientY - rect.top) / rect.height) * state.map.height);
    const description = describeMapCell(state, x, y);
    if (!description) return;

    tooltip.textContent = description;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(0, Math.min(event.clientX - rect.left + 12, rect.width - 205))}px`;
    tooltip.style.top = `${Math.max(0, event.clientY - rect.top - 45)}px`;
  };
}
