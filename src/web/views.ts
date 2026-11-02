import { inventoryWeight } from "../engine/pathfinding.ts";
import type { BotMetadata, BotState, GameEvent, Snapshot } from "../engine/types.ts";

function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return String(value).replace(/[&<>"']/g, (character) => entities[character]!);
}

export function botSelection(bots: BotMetadata[], selected: ReadonlySet<string>): string {
  if (!bots.length) return '<p class="muted">No bots found.</p>';
  return bots
    .map(
      (bot) => `
    <label class="bot-card" title="${escapeHtml(bot.description)}">
      <input class="bot-select" type="checkbox" value="${escapeHtml(bot.id)}"
        ${selected.has(bot.id) ? "checked" : ""} />
      <strong>${escapeHtml(bot.name)}</strong>
    </label>
  `,
    )
    .join("");
}

export function standings(state: Snapshot): string {
  return [...state.bots]
    .sort((a, b) => b.score - a.score)
    .map((bot) => scoreCard(bot, state.config.capacity))
    .join("");
}

function scoreCard(bot: BotState, capacity: number): string {
  const load = inventoryWeight(bot.inventory);
  const fillPercent = Math.min(100, (load / capacity) * 100);
  const action = `${bot.captures} captures · ${bot.stolen} stolen · ${bot.lost} lost · ${bot.disabled ? "Disabled · " : ""}${bot.lastAction}${bot.errors ? ` · ${bot.errors} errors` : ""}`;
  return `
    <div class="score-card" style="--bot-color:${bot.color}" title="${escapeHtml(action)}">
      <div class="score-card-head">
        <span class="bot-dot" aria-hidden="true"></span>
        <strong>${escapeHtml(bot.name)}</strong>
        <span class="score-number" aria-label="${bot.score} points">${bot.score}</span>
      </div>
      <div class="bag-row" aria-label="Inventory weight ${load} of ${capacity}" title="Inventory weight">
        <div class="bag-track"><div class="bag-fill" style="width:${fillPercent}%"></div></div>
        <span>${load}/${capacity}</span>
      </div>
      ${bot.errors ? `<p class="bot-error">${bot.disabled ? "Disabled" : `${bot.errors} errors`}</p>` : ""}
    </div>
  `;
}

export function eventLog(bots: BotState[], events: GameEvent[]): string {
  if (!events.length) {
    return '<p class="empty-log">No activity.</p>';
  }
  return events
    .map((event) => {
      const bot = bots.find((bot) => bot.id === event.botId)!;
      return `
      <div class="log-entry ${event.kind}" style="--bot-color:${bot.color}">
        <small>T${String(event.tick).padStart(3, "0")} / ${escapeHtml(bot.name)}</small>
        <p>${escapeHtml(event.message)}</p>
      </div>
    `;
    })
    .join("");
}
