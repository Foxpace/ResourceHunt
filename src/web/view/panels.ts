import type { MatchStatistics } from "../../engine/match-statistics.ts";
import { inventoryWeight } from "../../engine/pathfinding.ts";
import {
  MAX_BOTS,
  type BotMetadata,
  type BotState,
  type GameEvent,
  type Snapshot,
} from "../../engine/types.ts";
import { botMonogram } from "./board-units.ts";

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
  if (!bots.length) return '<p class="muted">No bots found. Add one to the bots folder.</p>';

  const full = selected.length >= MAX_BOTS;
  return bots
    .map((bot) => renderBotOption(bot, { copies: countCopies(selected, bot.id), full }))
    .join("");
}

function countCopies(selected: readonly string[], id: string): number {
  return selected.filter((selectedId) => selectedId === id).length;
}

function renderBotOption(bot: BotMetadata, lineup: { copies: number; full: boolean }): string {
  const { copies, full } = lineup;
  const id = escapeHtml(bot.id);
  const name = escapeHtml(bot.name);
  return `<div class="roster-row${copies ? " is-active" : ""}" title="${escapeHtml(bot.description)}">
    <label class="roster-pick"><input class="bot-select" id="select-${id}" type="checkbox" value="${id}" ${copies ? "checked" : ""} />
      <span class="roster-avatar" aria-hidden="true">${escapeHtml(botMonogram(bot.name))}</span>
      <span class="roster-text"><strong>${name}</strong><small>${escapeHtml(bot.description)}</small></span></label>
    <div class="stepper">
      <button class="bot-step" type="button" data-bot-id="${id}" data-delta="-1" aria-label="Remove a copy of ${name}" ${copies ? "" : "disabled"}>−</button>
      <input class="bot-copies" id="copies-${id}" data-bot-id="${id}" type="number" min="0" max="${MAX_BOTS}"
        value="${copies}" aria-label="Copies of ${name}" required />
      <button class="bot-step" type="button" data-bot-id="${id}" data-delta="1" aria-label="Add a copy of ${name}" ${full ? "disabled" : ""}>+</button>
    </div>
  </div>`;
}

export function renderStandings(state: Snapshot): string {
  const ranked = [...state.bots].sort((first, second) => second.score - first.score);
  const leaderScore = ranked[0]?.score ?? 0;

  return ranked
    .map((bot, index) => renderStanding(bot, { rank: index + 1, state, leaderScore }))
    .join("");
}

interface StandingContext {
  rank: number;
  state: Snapshot;
  leaderScore: number;
}

function renderStanding(bot: BotState, standing: StandingContext): string {
  const capacity = standing.state.config.capacity;
  const load = inventoryWeight(bot.inventory);
  const fillPercent = Math.min(100, (load / capacity) * 100);
  const leading = standing.rank === 1 && bot.score > 0;
  const gap = standing.leaderScore - bot.score;
  const status = bot.disabled ? "Disabled" : bot.lastAction;

  return `
    <li class="standing${leading ? " is-leader" : ""}${bot.disabled ? " is-disabled" : ""}" style="--bot-color:${bot.color}" title="${escapeHtml(status)}">
      <span class="standing-rank">${standing.rank}</span>
      <span class="standing-token" aria-hidden="true">${escapeHtml(botMonogram(bot.name))}</span>
      <div class="standing-body">
        <div class="standing-top">
          <strong>${escapeHtml(bot.name)}</strong>
          <span class="standing-score" aria-label="${bot.score} points">${bot.score}</span>
        </div>
        <div class="cargo" aria-label="Inventory weight ${load} of ${capacity}" title="Cargo weight">
          <div class="cargo-track"><i style="width:${fillPercent}%"></i></div>
          <small>${load}/${capacity}</small>
        </div>
        <div class="standing-meta">
          <span title="Outposts captured">⚑ ${bot.captures}</span><span title="Items stolen">⇆ ${bot.stolen}</span><span title="Items lost">↯ ${bot.lost}</span>
          ${gap > 0 ? `<span class="standing-gap" title="Points behind the leader">−${gap}</span>` : ""}
        </div>
        ${bot.errors ? `<p class="bot-error">${bot.disabled ? "Disabled after errors" : `${bot.errors} errors`}</p>` : ""}
      </div>
    </li>
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
    return '<p class="empty-log">Nothing has happened yet.</p>';
  }

  return events
    .map((event) => {
      const bot = bots.find((bot) => bot.id === event.botId) ?? { name: "World", color: "#e6bf81" };

      return `
      <div class="log-entry ${event.kind}" style="--bot-color:${bot.color}">
        <span class="log-tick">T${event.tick}</span>
        <p><b>${escapeHtml(bot.name)}</b> ${escapeHtml(event.message)}</p>
      </div>
    `;
    })
    .join("");
}
