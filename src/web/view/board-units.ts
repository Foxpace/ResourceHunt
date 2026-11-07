import { inventoryWeight, samePosition } from "../../engine/pathfinding.ts";
import type { BotState, Position, Snapshot } from "../../engine/types.ts";
import { animatedBotPosition, type MapAnimation } from "../model/map-motion.ts";
import { cellCenter, drawAtCell, type CanvasGrid } from "./canvas-grid.ts";

/** Short token label: the strategy initial plus the replica number, such as "S2". */
export function botMonogram(name: string): string {
  const copy = name.match(/#(\d+)$/)?.[1] ?? "";
  const initial = name.trim().charAt(0).toUpperCase() || "?";

  return initial + copy;
}

/** Bots drawn as lettered tokens with a cargo ring, a short motion trail, and status rings. */
export class BoardUnits {
  constructor(
    private grid: CanvasGrid,
    private state: Snapshot,
    private animation?: MapAnimation,
  ) {}

  drawTrail(bot: BotState): void {
    const previousBot = this.animation?.previous?.bots.find((candidate) => candidate.id === bot.id);
    const progress = this.animation?.progress ?? 1;
    const botMoved = !!previousBot && !samePosition(previousBot.position, bot.position);
    const animationInProgress = progress < 1;
    if (!botMoved || !animationInProgress) return;

    const { context, cellSize } = this.grid;
    const from = cellCenter(this.grid, previousBot.position);
    const to = cellCenter(this.grid, this.positionOf(bot));
    const stroke = context.createLinearGradient(from.x, from.y, to.x, to.y);
    stroke.addColorStop(0, `${bot.color}00`);
    stroke.addColorStop(1, `${bot.color}88`);
    context.save();
    context.globalAlpha = 1 - progress * 0.7;
    context.strokeStyle = stroke;
    context.lineWidth = cellSize * 0.26;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    context.restore();
  }

  drawBot(bot: BotState): void {
    drawAtCell(this.grid, this.positionOf(bot), (context) => {
      context.fillStyle = "#00000070";
      context.beginPath();
      context.ellipse(0.03, 0.36, 0.34, 0.11, 0, 0, Math.PI * 2);
      context.fill();
      this.drawCargoRing(context, bot);
      drawTokenBody(context, bot);
      this.drawStatusRings(context, bot);
    });
  }

  drawLabels(cell: Position): void {
    const bots = this.state.bots.filter((bot) => samePosition(bot.position, cell));
    for (const [index, bot] of bots.entries()) {
      const center = cellCenter(this.grid, this.positionOf(bot));
      const y = center.y - this.grid.cellSize * (0.75 + index * 0.62);
      drawNameTag(this.grid.context, bot, { x: center.x, y });
    }
  }

  private positionOf(bot: BotState): Position {
    const position = animatedBotPosition(bot, this.animation);
    const sharing = this.state.bots.filter((other) => samePosition(other.position, bot.position));
    if (sharing.length < 2) return position;

    const offset = (sharing.indexOf(bot) - (sharing.length - 1) / 2) * 0.36;
    return { x: position.x + offset, y: position.y };
  }

  private drawCargoRing(context: CanvasRenderingContext2D, bot: BotState): void {
    const load = inventoryWeight(bot.inventory);
    if (!load) return;

    const share = Math.min(1, load / this.state.config.capacity);
    context.lineWidth = 0.1;
    context.strokeStyle = "#00000099";
    context.beginPath();
    context.arc(0, 0, 0.5, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = share >= 1 ? "#ffe07a" : "#fff6d2";
    context.lineCap = "round";
    context.beginPath();
    context.arc(0, 0, 0.5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share);
    context.stroke();
  }

  private drawStatusRings(context: CanvasRenderingContext2D, bot: BotState): void {
    if (bot.theftProtectedUntilTick <= this.state.tick) return;

    context.strokeStyle = "#f0f5d2aa";
    context.lineWidth = 0.035;
    context.setLineDash([0.08, 0.08]);
    context.beginPath();
    context.arc(0, 0, 0.6, 0, Math.PI * 2);
    context.stroke();
    context.setLineDash([]);
  }
}

function drawTokenBody(context: CanvasRenderingContext2D, bot: BotState): void {
  const color = bot.disabled ? "#6c7469" : bot.color;
  const body = context.createRadialGradient(-0.12, -0.14, 0.02, 0, 0, 0.41);
  body.addColorStop(0, "#ffffff");
  body.addColorStop(0.18, color);
  body.addColorStop(1, shade(color));
  context.shadowColor = color;
  context.shadowBlur = bot.disabled ? 0 : 10;
  context.fillStyle = body;
  context.beginPath();
  context.arc(0, 0, 0.4, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
  context.strokeStyle = "#08110d";
  context.lineWidth = 0.05;
  context.stroke();

  const label = botMonogram(bot.name);
  context.fillStyle = "#0b1510";
  context.font = `800 ${label.length > 1 ? 0.32 : 0.42}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, 0, 0.02);
  if (bot.disabled) drawDisabledMark(context);
}

function drawDisabledMark(context: CanvasRenderingContext2D): void {
  context.strokeStyle = "#ff7a6b";
  context.lineWidth = 0.07;
  context.beginPath();
  context.moveTo(-0.24, -0.24);
  context.lineTo(0.24, 0.24);
  context.moveTo(0.24, -0.24);
  context.lineTo(-0.24, 0.24);
  context.stroke();
}

function drawNameTag(context: CanvasRenderingContext2D, bot: BotState, anchor: Position): void {
  context.save();
  context.font = "600 11px system-ui, sans-serif";
  const text = `${bot.name} · ${bot.score}`;
  const width = context.measureText(text).width + 14;
  context.fillStyle = "#08100ee6";
  context.strokeStyle = bot.color;
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(anchor.x - width / 2, anchor.y - 10, width, 20, 10);
  context.fill();
  context.stroke();
  context.fillStyle = "#eef4ea";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, anchor.x, anchor.y + 0.5);
  context.restore();
}

/** Darkens a #rrggbb color for token edges. */
function shade(color: string): string {
  const value = Number.parseInt(color.slice(1, 7), 16);
  const channels = [16, 8, 0].map((shift) => Math.round(((value >> shift) & 255) * 0.55));

  return `rgb(${channels.join(",")})`;
}
