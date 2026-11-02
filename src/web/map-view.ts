import { samePosition } from "../engine/pathfinding.ts";
import { RESOURCES, TERRAIN_COST, type Snapshot } from "../engine/types.ts";

import { drawTerrain } from "./terrain-view.ts";

export function drawMap(canvas: HTMLCanvasElement, state: Snapshot) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D rendering is unavailable");
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cw = rect.width / state.map.width,
    ch = rect.height / state.map.height,
    s = Math.min(cw, ch);
  drawTerrain(ctx, state.map, state.config.biome, cw, ch);
  for (const hotspot of state.hotspots) {
    const px = (hotspot.x + 0.5) * cw,
      py = (hotspot.y + 0.5) * ch;
    const radius = hotspot.radius + 0.55;
    ctx.save();
    ctx.strokeStyle = "#e3ca7880";
    ctx.fillStyle = "#e3ca780c";
    ctx.setLineDash([3, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py - radius * ch);
    ctx.lineTo(px + radius * cw, py);
    ctx.lineTo(px, py + radius * ch);
    ctx.lineTo(px - radius * cw, py);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  for (const post of state.outposts) {
    const px = (post.x + 0.5) * cw,
      py = (post.y + 0.5) * ch;
    const owner = state.bots.find((bot) => bot.id === post.ownerId);
    const capturer = state.bots.find((bot) => bot.id === post.capturingBotId);
    ctx.fillStyle = "#102016";
    ctx.fillRect(px - s * 0.43, py - s * 0.43, s * 0.86, s * 0.86);
    ctx.strokeStyle = owner?.color ?? "#c9d4c1";
    ctx.lineWidth = 1.4;
    ctx.strokeRect(px - s * 0.4, py - s * 0.4, s * 0.8, s * 0.8);
    ctx.beginPath();
    ctx.moveTo(px - s * 0.15, py + s * 0.27);
    ctx.lineTo(px - s * 0.15, py - s * 0.27);
    ctx.stroke();
    ctx.fillStyle = owner?.color ?? "#c9d4c1";
    ctx.beginPath();
    ctx.moveTo(px - s * 0.15, py - s * 0.27);
    ctx.lineTo(px + s * 0.3, py - s * 0.1);
    ctx.lineTo(px - s * 0.15, py + s * 0.05);
    ctx.fill();
    if (capturer) {
      ctx.strokeStyle = capturer.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(
        px,
        py,
        s * 0.5,
        -Math.PI / 2,
        -Math.PI / 2 + (Math.PI * 2 * post.captureProgress) / state.config.captureTurns,
      );
      ctx.stroke();
    }
  }
  for (const pile of state.resources) {
    const x = (pile.x + 0.5) * cw,
      y = (pile.y + 0.5) * ch,
      r = s * 0.2;
    ctx.fillStyle = "#112018aa";
    ctx.beginPath();
    ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = RESOURCES[pile.kind].color;
    if (pile.kind === "ore") {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(x, y - r * 1.4);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r * 1.4);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      if (pile.kind === "relic") {
        ctx.strokeStyle = "#f1e4ff";
        ctx.stroke();
      }
    }
  }
  for (const bot of state.bots) {
    const x = bot.base.x * cw,
      y = bot.base.y * ch;
    ctx.fillStyle = bot.color + "33";
    ctx.fillRect(x - cw * 0.1, y - ch * 0.1, cw * 1.2, ch * 1.2);
    ctx.strokeStyle = bot.color;
    ctx.lineWidth = 1.3;
    ctx.strokeRect(x + 0.5, y + 0.5, cw - 1, ch - 1);
    ctx.fillStyle = bot.color;
    ctx.font = `bold ${s * 0.65}px monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⌂", x + cw * 0.5, y + ch * 0.52);
  }
  for (const bot of state.bots) {
    const collocated = state.bots.filter((other) => samePosition(other.position, bot.position));
    const offset =
      collocated.length > 1
        ? (collocated.indexOf(bot) - (collocated.length - 1) / 2) * s * 0.27
        : 0;
    const x = (bot.position.x + 0.5) * cw + offset,
      y = (bot.position.y + 0.5) * ch;
    ctx.fillStyle = "#0e1c12";
    ctx.beginPath();
    ctx.arc(x, y + 1, s * 0.43, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bot.disabled ? "#63715e" : bot.color;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.33, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1b281f";
    ctx.fillRect(x - s * 0.17, y - s * 0.08, s * 0.34, s * 0.14);
    if (bot.inventory.length) {
      ctx.fillStyle = "#f6f5d1";
      ctx.beginPath();
      ctx.arc(x + s * 0.24, y - s * 0.23, s * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    if (bot.theftProtectedUntilTick > state.tick) {
      ctx.strokeStyle = "#f0f5d280";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, s * 0.44, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

export function attachMapTooltip(
  canvas: HTMLCanvasElement,
  tooltip: HTMLElement,
  getSnapshot: () => Snapshot | undefined,
): () => void {
  const onMouseMove = (event: MouseEvent) => {
    const state = getSnapshot();
    if (!state) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * state.map.width),
      y = Math.floor(((event.clientY - rect.top) / rect.height) * state.map.height);
    const terrain = state.map.tiles[y]?.[x];
    if (!terrain) return;
    const resource = state.resources.find((pile) => pile.x === x && pile.y === y);
    const bots = state.bots.filter((bot) => bot.position.x === x && bot.position.y === y);
    const post = state.outposts.find((post) => post.x === x && post.y === y);
    const hotspot = state.hotspots.find(
      (site) => Math.abs(site.x - x) + Math.abs(site.y - y) <= site.radius,
    );
    const owner = state.bots.find((bot) => bot.id === post?.ownerId);
    tooltip.textContent = `${x},${y} · ${terrain} · ${Number.isFinite(TERRAIN_COST[terrain]) ? `${TERRAIN_COST[terrain]} turn${TERRAIN_COST[terrain] === 1 ? "" : "s"}` : "blocked"}${resource ? ` · ${resource.amount} ${resource.kind}` : ""}${bots.length ? ` · ${bots.map((bot) => bot.name).join(", ")}` : ""}`;
    if (post)
      tooltip.textContent += ` · ${post.id}: ${owner?.name ?? "neutral"}${post.captureProgress ? ` · capture ${post.captureProgress}/${state.config.captureTurns}` : ""}`;
    if (hotspot) tooltip.textContent += ` · ${hotspot.id}`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(0, Math.min(event.clientX - rect.left + 12, rect.width - 205))}px`;
    tooltip.style.top = `${Math.max(0, event.clientY - rect.top - 45)}px`;
  };
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
