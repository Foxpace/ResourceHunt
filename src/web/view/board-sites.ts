import {
  RESOURCES,
  type BotState,
  type Hotspot,
  type Outpost,
  type Position,
  type ResourceKind,
  type ResourcePile,
  type Snapshot,
} from "../../engine/types.ts";
import { drawAtCell, type CanvasGrid } from "./canvas-grid.ts";

const NEUTRAL = "#d6ddd0";
const CLUSTERS: readonly (readonly Position[])[] = [
  [{ x: 0, y: 0 }],
  [
    { x: -0.14, y: 0.06 },
    { x: 0.14, y: -0.06 },
  ],
  [
    { x: -0.16, y: 0.1 },
    { x: 0.16, y: 0.1 },
    { x: 0, y: -0.13 },
  ],
];

/** Static sites players fight over: hotspots, depots, bases, and resource piles. */
export class BoardSites {
  constructor(
    private grid: CanvasGrid,
    private state: Snapshot,
    private time = 0,
  ) {}

  drawHotspot(hotspot: Hotspot): void {
    const radius = hotspot.radius + 0.55;
    drawAtCell(this.grid, hotspot, (context) => {
      const glow = context.createRadialGradient(0, 0, 0, 0, 0, radius);
      glow.addColorStop(0, "#f3d36e2e");
      glow.addColorStop(1, "#f3d36e00");
      context.fillStyle = glow;
      context.beginPath();
      context.moveTo(0, -radius);
      context.lineTo(radius, 0);
      context.lineTo(0, radius);
      context.lineTo(-radius, 0);
      context.closePath();
      context.fill();
      context.strokeStyle = "#f3d36e8c";
      context.lineWidth = 0.05;
      context.setLineDash([0.16, 0.14]);
      context.lineDashOffset = -this.time * 0.25;
      context.stroke();
    });
  }

  drawOutpost(post: Outpost): void {
    const owner = this.ownerOf(post.ownerId);
    const color = owner?.color ?? NEUTRAL;
    drawAtCell(this.grid, post, (context) => {
      context.shadowColor = color;
      context.shadowBlur = owner ? 10 : 0;
      roundedRect(context, { x: -0.42, y: -0.42, size: 0.84, radius: 0.16 });
      context.fillStyle = "#101b16";
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = color;
      context.lineWidth = 0.07;
      context.stroke();
      drawPennant(context, color, !!owner);
    });

    const capturer = this.ownerOf(post.capturingBotId);
    if (capturer) this.drawCaptureProgress(post, capturer);
  }

  drawBase(bot: BotState): void {
    drawAtCell(this.grid, bot.base, (context) => {
      const halo = context.createRadialGradient(0, 0, 0.1, 0, 0, 0.95);
      halo.addColorStop(0, `${bot.color}55`);
      halo.addColorStop(1, `${bot.color}00`);
      context.fillStyle = halo;
      context.fillRect(-1, -1, 2, 2);
      roundedRect(context, { x: -0.46, y: -0.46, size: 0.92, radius: 0.18 });
      context.fillStyle = `${bot.color}30`;
      context.fill();
      context.strokeStyle = bot.color;
      context.lineWidth = 0.07;
      context.stroke();
      drawHouse(context, bot.color);
    });
  }

  drawResource(pile: ResourcePile): void {
    const spots = CLUSTERS[Math.min(pile.amount, 3) - 1] ?? CLUSTERS[0]!;
    drawAtCell(this.grid, pile, (context) => {
      context.fillStyle = "#00000040";
      context.beginPath();
      context.ellipse(0, 0.2, 0.3, 0.1, 0, 0, Math.PI * 2);
      context.fill();
      const twinkle = 0.85 + Math.sin(this.time * 3 + pile.x + pile.y * 2) * 0.15;
      const scale = spots.length > 1 ? 0.95 : 1.15;
      for (const spot of spots) {
        context.save();
        context.translate(spot.x, spot.y);
        context.scale(scale, scale);
        drawResourceItem(context, pile.kind, twinkle);
        context.restore();
      }
    });
  }

  private drawCaptureProgress(post: Outpost, capturer: BotState): void {
    const share = post.captureProgress / this.state.config.captureTurns;
    drawAtCell(this.grid, post, (context) => {
      context.lineWidth = 0.09;
      context.strokeStyle = "#00000088";
      context.beginPath();
      context.arc(0, 0, 0.56, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = capturer.color;
      context.lineCap = "round";
      context.beginPath();
      context.arc(0, 0, 0.56, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * share);
      context.stroke();
    });
  }

  private ownerOf(id: string | null): BotState | undefined {
    return this.state.bots.find((bot) => bot.id === id);
  }
}

export function roundedRect(
  context: CanvasRenderingContext2D,
  shape: { x: number; y: number; size: number; radius: number },
): void {
  context.beginPath();
  context.roundRect(shape.x, shape.y, shape.size, shape.size, shape.radius);
}

function drawPennant(context: CanvasRenderingContext2D, color: string, owned: boolean): void {
  context.strokeStyle = "#e9eee4";
  context.lineWidth = 0.05;
  context.beginPath();
  context.moveTo(-0.14, 0.28);
  context.lineTo(-0.14, -0.3);
  context.stroke();
  context.fillStyle = owned ? color : `${color}99`;
  context.beginPath();
  context.moveTo(-0.12, -0.3);
  context.lineTo(0.26, -0.17);
  context.lineTo(-0.12, -0.04);
  context.closePath();
  context.fill();
  context.fillStyle = "#e9eee4";
  context.fillRect(-0.26, 0.24, 0.24, 0.06);
}

function drawHouse(context: CanvasRenderingContext2D, color: string): void {
  context.fillStyle = "#0d1813";
  context.beginPath();
  context.moveTo(-0.3, -0.02);
  context.lineTo(0, -0.3);
  context.lineTo(0.3, -0.02);
  context.lineTo(0.22, -0.02);
  context.lineTo(0.22, 0.26);
  context.lineTo(-0.22, 0.26);
  context.lineTo(-0.22, -0.02);
  context.closePath();
  context.fill();
  context.fillStyle = color;
  context.beginPath();
  context.moveTo(-0.24, -0.04);
  context.lineTo(0, -0.24);
  context.lineTo(0.24, -0.04);
  context.closePath();
  context.fill();
  context.fillRect(-0.16, 0, 0.32, 0.2);
  context.fillStyle = "#0d1813";
  context.fillRect(-0.05, 0.07, 0.1, 0.13);
}

function drawResourceItem(context: CanvasRenderingContext2D, kind: ResourceKind, twinkle: number) {
  if (kind === "ore") drawOreNugget(context);
  else if (kind === "crystal") drawCrystal(context);
  else drawRelic(context, twinkle);
}

function drawOreNugget(context: CanvasRenderingContext2D): void {
  context.fillStyle = "#6b4413";
  context.beginPath();
  context.ellipse(0.01, 0.02, 0.17, 0.14, 0.3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = RESOURCES.ore.color;
  context.beginPath();
  context.ellipse(0, 0, 0.15, 0.12, 0.3, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#fff0c2";
  context.beginPath();
  context.arc(-0.05, -0.04, 0.04, 0, Math.PI * 2);
  context.fill();
}

function drawCrystal(context: CanvasRenderingContext2D): void {
  const outline: [number, number][] = [
    [0, -0.25],
    [0.12, -0.1],
    [0.12, 0.12],
    [0, 0.24],
    [-0.12, 0.12],
    [-0.12, -0.1],
  ];
  context.fillStyle = RESOURCES.crystal.color;
  context.strokeStyle = "#0f4d49";
  context.lineWidth = 0.035;
  context.beginPath();
  for (const [x, y] of outline) context.lineTo(x, y);
  context.closePath();
  context.fill();
  context.stroke();
  context.fillStyle = "#d4fff8";
  context.beginPath();
  context.moveTo(0, -0.25);
  context.lineTo(-0.12, -0.1);
  context.lineTo(-0.12, 0.12);
  context.lineTo(0, 0.02);
  context.closePath();
  context.globalAlpha = 0.55;
  context.fill();
  context.globalAlpha = 1;
}

function drawRelic(context: CanvasRenderingContext2D, twinkle: number): void {
  context.shadowColor = RESOURCES.relic.color;
  context.shadowBlur = 8;
  context.fillStyle = RESOURCES.relic.color;
  context.beginPath();
  for (let index = 0; index < 8; index++) {
    const radius = (index % 2 ? 0.08 : 0.25) * twinkle;
    const angle = (index * Math.PI) / 4 - Math.PI / 2;
    context.lineTo(Math.cos(angle) * radius, Math.sin(angle) * radius);
  }
  context.closePath();
  context.fill();
  context.shadowBlur = 0;
  context.fillStyle = "#f6edff";
  context.beginPath();
  context.arc(0, 0, 0.06, 0, Math.PI * 2);
  context.fill();
}
