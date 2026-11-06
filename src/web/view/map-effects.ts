import type { GameEvent } from "../../engine/types.ts";
import type { MapAnimation } from "../model/map-motion.ts";
import type { CanvasGrid } from "./canvas-grid.ts";

const EFFECT_COLORS = {
  bank: "#dfef9a",
  collect: "#93f0ce",
  capture: "#eef7a3",
  steal: "#ffbc76",
  sabotage: "#ff8877",
  trap: "#ffa870",
  guard: "#a7edff",
  strike: "#dcb3ff",
  impact: "#ffba88",
  loot: "#f8d68c",
  error: "#ff6f88",
};

export function drawMapEffects(grid: CanvasGrid, animation?: MapAnimation): void {
  if (!animation) return;

  for (const effect of animation.effects) drawEventEffect(grid, effect.event, effect.progress);
}

function drawEventEffect(grid: CanvasGrid, event: GameEvent, progress: number): void {
  const { position, effect } = event;
  if (!position) return;
  if (!effect) return;

  const { context, cellWidth, cellHeight, cellSize } = grid;
  context.save();
  context.translate((position.x + 0.5) * cellWidth, (position.y + 0.5) * cellHeight);
  context.strokeStyle = EFFECT_COLORS[effect];
  context.fillStyle = EFFECT_COLORS[effect];
  context.globalAlpha = 1 - progress;
  context.lineWidth = 1.5;
  context.beginPath();
  context.arc(0, 0, cellSize * (0.25 + progress * 1.3), 0, Math.PI * 2);
  context.stroke();
  drawBurstParticles(grid, progress);
  drawEffectLabel(grid, event, progress);
  context.restore();
}

function drawEffectLabel(grid: CanvasGrid, event: GameEvent, progress: number): void {
  const { context, cellSize } = grid;
  context.font = `800 ${Math.max(11, cellSize * 0.5)}px system-ui, sans-serif`;
  context.textAlign = "center";
  context.lineWidth = 3;
  context.strokeStyle = "#08110dcc";
  const label =
    event.effect === "bank"
      ? (event.message.match(/\+\d+/)?.[0] ?? "+")
      : event.effect === "impact"
        ? "!"
        : "";
  if (!label) return;

  context.globalAlpha = Math.min(1, (1 - progress) * 1.6);
  context.strokeText(label, 0, -cellSize * (0.7 + progress));
  context.fillText(label, 0, -cellSize * (0.7 + progress));
}

function drawBurstParticles(grid: CanvasGrid, progress: number): void {
  const { context, cellSize } = grid;
  for (let index = 0; index < 7; index++) {
    const angle = (index * Math.PI * 2) / 7;
    const radius = cellSize * progress * 1.5;
    context.fillRect(Math.cos(angle) * radius, Math.sin(angle) * radius, 2, 2);
  }
}
