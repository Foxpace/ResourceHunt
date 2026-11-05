import type { MatchStatistics } from "../../engine/match-statistics.ts";
import { inventoryWeight } from "../../engine/pathfinding.ts";
import type { BotMetadata, BotState, GameEvent, Snapshot } from "../../engine/types.ts";

export function escapeHtml(value: unknown): string {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };

  return String(value).replace(/[&<>"']/g, (character) => entities[character]!);
}

export function renderBotSelection(
  bots: readonly BotMetadata[],
  selected: readonly string[],
): string {
  if (!bots.length) return '<p class="muted">No bots found.</p>';

  return bots
    .map((bot) => renderBotOption(bot, selected.filter((id) => id === bot.id).length))
    .join("");
}

function renderBotOption(bot: BotMetadata, copies: number): string {
  return `<div class="bot-card" title="${escapeHtml(bot.description)}">
    <label class="bot-choice"><input class="bot-select" id="select-${escapeHtml(bot.id)}" type="checkbox" value="${escapeHtml(bot.id)}" ${copies ? "checked" : ""} />
      <strong>${escapeHtml(bot.name)}</strong></label>
    <label class="bot-copies-label"><span>Copies</span>
      <input class="bot-copies" id="copies-${escapeHtml(bot.id)}" data-bot-id="${escapeHtml(bot.id)}" type="number" min="1" max="15"
        value="${copies || 1}" aria-label="Copies of ${escapeHtml(bot.name)}" ${copies ? "" : "disabled"} required />
    </label>
  </div>`;
}

export function renderStandings(state: Snapshot): string {
  return [...state.bots]
    .sort((first, second) => second.score - first.score)
    .map((bot) => renderScoreCard(bot, state.config.capacity))
    .join("");
}

function renderScoreCard(bot: BotState, capacity: number): string {
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

const statisticLabels: Record<keyof MatchStatistics, string> = {
  tilesWalked: "Tiles walked",
  gathered: "Resources gathered",
  deposits: "Deposits",
  stolenValue: "Value stolen",
  sabotageAttempts: "Sabotage attempts",
  sabotages: "Depots sabotaged",
  depotOfflineTicks: "Own depot ticks offline",
  repairs: "Repairs",
  trapsPlaced: "Traps placed",
  trapsTriggered: "Own traps triggered",
  trapsHit: "Enemy traps hit",
  trapsCleared: "Traps cleared",
  guardianStrikes: "Guardian hits",
  guardiansDefeated: "Guardians defeated",
  guardianRepels: "Guardian pushbacks suffered",
  cacheLooted: "Cache items looted",
  droneStrikes: "Drone hits",
  droneStuns: "Drone stuns suffered",
};

export function renderStatisticsOptions(bots: BotState[]): string {
  return bots
    .map(({ id, name }) => `<option value="${escapeHtml(id)}">${escapeHtml(name)}</option>`)
    .join("");
}

export function renderBotStatistics(state: Snapshot, id: string): string {
  const bot = state.bots.find((participant) => participant.id === id);
  if (!bot) return "";

  const counters = state.statistics?.[id];
  const rows = [
    renderStatistic("Points", bot.score),
    renderStatistic("Items banked", bot.delivered),
    renderStatistic("Depots captured", bot.captures),
    renderStatistic("Items stolen", bot.stolen),
    renderStatistic("Items lost", bot.lost),
    renderStatistic("Bot errors", bot.errors),
  ];
  for (const key of Object.keys(statisticLabels) as (keyof MatchStatistics)[]) {
    const value = counters?.[key];
    if (value !== undefined) rows.push(renderStatistic(statisticLabels[key], value));
  }

  const notice = counters
    ? ""
    : '<p class="muted">This replay has no detailed counters for this tick.</p>';
  return `<dl class="bot-statistics-grid">${rows.join("")}</dl>${notice}`;
}

function renderStatistic(label: string, value: number): string {
  return `<div><dt>${label}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

export function renderEventLog(bots: BotState[], events: GameEvent[]): string {
  if (!events.length) {
    return '<p class="empty-log">No activity.</p>';
  }

  return events
    .map((event) => {
      const bot = bots.find((bot) => bot.id === event.botId) ?? { name: "World", color: "#e6bf81" };

      return `
      <div class="log-entry ${event.kind}" style="--bot-color:${bot.color}">
        <small>T${String(event.tick).padStart(3, "0")} / ${escapeHtml(bot.name)}</small>
        <p>${escapeHtml(event.message)}</p>
      </div>
    `;
    })
    .join("");
}
