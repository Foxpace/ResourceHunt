import type { Position, Snapshot } from "../../engine/types.ts";
import type { GuardianCache, NaturalHazard, ScavengerDrone } from "../../engine/world/types.ts";
import {
  animatedBotPosition,
  animatedDronePosition,
  animatedGuardianPosition,
  type MapAnimation,
} from "../model/map-motion.ts";
import { drawAtCell, type CanvasGrid } from "./canvas-grid.ts";

export class WorldOverlays {
  constructor(
    private grid: CanvasGrid,
    private state: Snapshot,
    private animation?: MapAnimation,
  ) {}

  draw(): void {
    for (const hazard of this.state.world.hazards) this.drawHazard(hazard);
    for (const cache of this.state.world.caches) {
      this.drawCache(cache);
      this.drawGuardian(cache);
    }
    for (const drone of this.state.world.drones) this.drawDrone(drone);
    for (const trap of this.state.world.traps) this.drawTrap(trap);

    this.drawDepotProtection();
    this.drawDepotDamage();
    this.drawGuardShields();
  }

  private atCell(position: Position, draw: (context: CanvasRenderingContext2D) => void): void {
    drawAtCell(this.grid, position, draw);
  }

  private drawCache(cache: GuardianCache): void {
    this.atCell(cache.position, (context) => {
      const guarded = cache.guardianHealth > 0;
      context.fillStyle = guarded ? "#281b36" : "#283523";
      context.strokeStyle = guarded ? "#d7a5ff" : "#efd282";
      context.lineWidth = 0.065;
      context.shadowColor = context.strokeStyle;
      context.shadowBlur = guarded ? 12 : 5;
      context.beginPath();
      for (let index = 0; index < 6; index++) {
        const angle = (index * Math.PI) / 3 - Math.PI / 2;
        context.lineTo(Math.cos(angle) * 0.4, Math.sin(angle) * 0.4);
      }
      context.closePath();
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.fillStyle = context.strokeStyle;
      context.font = "bold 0.42px monospace";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(cache.inventory.length ? "◆" : "·", 0, 0);
    });
  }

  private drawGuardian(cache: GuardianCache): void {
    if (!cache.guardianHealth) return;

    this.atCell(animatedGuardianPosition(cache, this.animation), (context) => {
      const time = this.animation?.time ?? 0;
      context.translate(0, -0.13 + Math.sin(time * 4) * 0.04);
      context.fillStyle = "#321f48";
      context.strokeStyle = "#deb2ff";
      context.lineWidth = 0.065;
      context.shadowColor = context.strokeStyle;
      context.shadowBlur = 10;
      context.beginPath();
      context.moveTo(-0.34, -0.22);
      context.lineTo(0.34, -0.22);
      context.lineTo(0.23, 0.18);
      context.lineTo(0, 0.31);
      context.lineTo(-0.23, 0.18);
      context.closePath();
      context.fill();
      context.stroke();
      context.shadowBlur = 0;
      context.fillStyle = "#f1d8ff";
      context.fillRect(-0.15, -0.09, 0.3, 0.075);
      drawHealthPips(context, cache.guardianHealth);
    });
  }

  private drawDrone(drone: ScavengerDrone): void {
    if (!drone.health) return;

    this.drawDroneRoute(drone);
    this.atCell(animatedDronePosition(drone, this.animation), (context) => {
      const time = this.animation?.time ?? 0;
      context.translate(0, Math.sin(time * 4 + drone.position.x) * 0.055);
      context.strokeStyle = "#7be5ef";
      context.fillStyle = "#123139";
      context.lineWidth = 0.055;
      context.shadowColor = "#7be5ef";
      context.shadowBlur = 9;
      context.fillRect(-0.25, -0.18, 0.5, 0.36);
      context.strokeRect(-0.25, -0.18, 0.5, 0.36);
      context.beginPath();
      context.moveTo(-0.43, -0.25);
      context.lineTo(0.43, -0.25);
      context.stroke();
      context.fillStyle = "#d7fbff";
      context.fillRect(-0.12, -0.07, 0.24, 0.1);
      context.shadowBlur = 0;
      drawHealthPips(context, drone.health);
      if (drone.inventory.length) context.fillRect(0.22, 0.2, 0.12, 0.12);
    });
  }

  private drawDroneRoute(drone: ScavengerDrone): void {
    const { context, cellWidth, cellHeight } = this.grid;
    context.save();
    context.strokeStyle = "#7be5ef36";
    context.setLineDash([2, 5]);
    context.beginPath();
    context.moveTo((drone.position.x + 0.5) * cellWidth, (drone.position.y + 0.5) * cellHeight);
    for (const cell of drone.route.slice(0, 6))
      context.lineTo((cell.x + 0.5) * cellWidth, (cell.y + 0.5) * cellHeight);

    context.stroke();
    context.restore();
  }

  private drawTrap(trap: Snapshot["world"]["traps"][number]): void {
    this.atCell(trap, (context) => {
      const armed = trap.armedAt <= this.state.tick;
      context.strokeStyle = armed ? "#ffa66b" : "#a4aeb8";
      context.fillStyle = armed ? "#e868243b" : "#8795a333";
      context.lineWidth = 0.055;
      context.beginPath();
      context.moveTo(0, -0.34);
      context.lineTo(0.36, 0.28);
      context.lineTo(-0.36, 0.28);
      context.closePath();
      context.fill();
      context.stroke();
      context.fillStyle = context.strokeStyle;
      context.font = "bold 0.36px monospace";
      context.textAlign = "center";
      context.fillText("!", 0, 0.18);
    });
  }

  private drawHazard(hazard: NaturalHazard): void {
    const active = hazard.startsAt <= this.state.tick;
    const color = hazardColor(hazard);
    const cells = new Set(hazard.cells.map(({ x, y }) => `${x},${y}`));
    for (const cell of hazard.cells) {
      this.atCell(cell, (context) => {
        context.fillStyle = `${color}${active ? "4a" : "1c"}`;
        context.fillRect(-0.5, -0.5, 1, 1);
        if (!active) drawHazardHatch(context, color);
        context.strokeStyle = `${color}d0`;
        context.lineWidth = active ? 0.07 : 0.05;
        context.setLineDash(active ? [] : [0.14, 0.1]);
        drawZoneEdges(context, { cell, cells });
        if (active) this.drawHazardMotion(context, hazard, cell);
      });
    }
    this.drawHazardBadge(hazard, { active, color });
  }

  private drawHazardBadge(hazard: NaturalHazard, style: { active: boolean; color: string }): void {
    const label = style.active ? "!" : String(hazard.startsAt - this.state.tick);
    this.atCell(hazard.center, (context) => {
      context.fillStyle = "#08131fee";
      context.strokeStyle = style.color;
      context.lineWidth = 0.06;
      context.beginPath();
      context.roundRect(-0.46, -0.27, 0.92, 0.54, 0.27);
      context.fill();
      context.stroke();
      context.fillStyle = style.color;
      context.font = "800 0.34px system-ui, sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText(label, 0, 0.02);
    });
  }

  private drawHazardMotion(
    context: CanvasRenderingContext2D,
    hazard: NaturalHazard,
    cell: Position,
  ): void {
    const phase = ((this.animation?.time ?? 0) * 0.8 + cell.x * 0.17 + cell.y * 0.31) % 1;
    context.setLineDash([]);
    if (hazard.kind === "meteors") {
      drawMeteorTrail(context, phase);
      return;
    }
    if (hazard.kind === "boulders") {
      drawRollingBoulder(context, phase);
      return;
    }

    drawWeatherStreak(context, phase);
    if (hazard.kind === "storm") drawLightning(context, phase);
  }

  private drawDepotProtection(): void {
    for (const outpost of this.state.outposts) {
      const remaining = (outpost.captureProtectedUntilTick ?? 0) - this.state.tick;
      if (remaining <= 0) continue;

      this.atCell(outpost, (context) => {
        context.strokeStyle = "#9ce6f5";
        context.lineWidth = 0.06;
        context.shadowColor = "#9ce6f5";
        context.shadowBlur = 8;
        context.beginPath();
        context.arc(0, 0, 0.49, 0, Math.PI * 2);
        context.stroke();
        context.shadowBlur = 0;
        context.fillStyle = "#c6f0f8";
        context.font = "bold 0.3px monospace";
        context.textAlign = "center";
        context.fillText(String(remaining), 0, -0.58);
      });
    }
  }

  private drawDepotDamage(): void {
    for (const outpost of this.state.outposts) {
      const disabled = (outpost.disabledUntilTick ?? 0) > this.state.tick;
      const targeted = (outpost.sabotageProgress ?? 0) > 0;
      if (!disabled && !targeted) continue;

      this.atCell(outpost, (context) => {
        context.strokeStyle = "#ff786c";
        context.lineWidth = 0.09;
        context.beginPath();
        context.moveTo(-0.32, -0.32);
        context.lineTo(0.32, 0.32);
        context.moveTo(0.32, -0.32);
        context.lineTo(-0.32, 0.32);
        context.stroke();
      });
    }
  }

  private drawGuardShields(): void {
    for (const defense of this.state.world.defenses) {
      if (defense.guardedUntilTick <= this.state.tick) continue;

      const bot = this.state.bots.find((candidate) => candidate.id === defense.botId)!;
      this.atCell(animatedBotPosition(bot, this.animation), (context) => {
        context.strokeStyle = "#a6e8f4";
        context.lineWidth = 0.055;
        context.beginPath();
        context.arc(0, 0, 0.48, 0, Math.PI * 2);
        context.stroke();
      });
    }
  }
}

function hazardColor(hazard: NaturalHazard): string {
  const fiery = hazard.kind === "lava" || hazard.kind === "wildfire";
  if (fiery) return "#ff9a4f";

  return hazard.kind === "meteors" ? "#c9a7ff" : "#8bd4ee";
}

function drawHazardHatch(context: CanvasRenderingContext2D, color: string): void {
  context.strokeStyle = `${color}40`;
  context.lineWidth = 0.05;
  context.beginPath();
  for (const offset of [-0.5, 0, 0.5]) {
    context.moveTo(offset - 0.5, 0.5);
    context.lineTo(offset + 0.5, -0.5);
  }
  context.stroke();
}

const EDGES = [
  { dx: 0, dy: -1, from: [-0.5, -0.5], to: [0.5, -0.5] },
  { dx: 1, dy: 0, from: [0.5, -0.5], to: [0.5, 0.5] },
  { dx: 0, dy: 1, from: [-0.5, 0.5], to: [0.5, 0.5] },
  { dx: -1, dy: 0, from: [-0.5, -0.5], to: [-0.5, 0.5] },
] as const;

/** Outlines only the zone boundary so a hazard reads as one area rather than many tiles. */
function drawZoneEdges(
  context: CanvasRenderingContext2D,
  zone: { cell: Position; cells: ReadonlySet<string> },
): void {
  context.beginPath();
  for (const edge of EDGES) {
    const neighbor = `${zone.cell.x + edge.dx},${zone.cell.y + edge.dy}`;
    if (zone.cells.has(neighbor)) continue;

    context.moveTo(edge.from[0], edge.from[1]);
    context.lineTo(edge.to[0], edge.to[1]);
  }
  context.stroke();
}

function drawHealthPips(context: CanvasRenderingContext2D, health: number): void {
  context.fillStyle = "#e1d4ff";
  for (let index = 0; index < health; index++)
    context.fillRect(-0.18 + index * 0.15, 0.44, 0.1, 0.055);
}

function drawWeatherStreak(context: CanvasRenderingContext2D, phase: number): void {
  const x = -0.36 + phase * 0.6;
  context.lineWidth = 0.04;
  context.beginPath();
  context.moveTo(x, -0.4);
  context.lineTo(x + 0.19, 0.13);
  context.stroke();
}

function drawLightning(context: CanvasRenderingContext2D, phase: number): void {
  if (phase > 0.16) return;

  context.strokeStyle = "#edfaff";
  context.lineWidth = 0.075;
  context.beginPath();
  context.moveTo(0.13, -0.37);
  context.lineTo(-0.11, -0.03);
  context.lineTo(0.12, -0.03);
  context.lineTo(-0.07, 0.34);
  context.stroke();
}

function drawMeteorTrail(context: CanvasRenderingContext2D, phase: number): void {
  const x = phase - 0.45;
  const y = phase * 0.8 - 0.4;
  context.lineWidth = 0.1;
  context.beginPath();
  context.moveTo(x - 0.26, y - 0.24);
  context.lineTo(x, y);
  context.stroke();
  context.fillStyle = "#e5d7ff";
  context.beginPath();
  context.arc(x, y, 0.12, 0, Math.PI * 2);
  context.fill();
}

function drawRollingBoulder(context: CanvasRenderingContext2D, phase: number): void {
  context.translate(phase * 0.65 - 0.33, 0.23);
  context.rotate(phase * Math.PI * 2);
  context.fillStyle = "#dfc8a9";
  context.fillRect(-0.1, -0.09, 0.2, 0.18);
}
