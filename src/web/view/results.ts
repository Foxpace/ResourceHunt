import { compareTournamentStandings, matchRows } from "../../competition/results.ts";
import { BOT_COLORS, type Snapshot } from "../../engine/types.ts";
import { botMonogram } from "./board-units.ts";
import { selectAwards, type AwardRow, type BadgeOptions } from "../../competition/awards.ts";
import { escapeHtml } from "./panels.ts";

interface ResultRow extends AwardRow {
  errors: number;
  wins?: number;
  badges?: number;
}

export interface ResultOptions {
  mode?: "match" | "tournament" | "in-progress";
  badges?: BadgeOptions;
  hiddenColumns?: ReadonlySet<string>;
  colors?: ReadonlyMap<string, string>;
  podium?: boolean;
}

export function renderMatchResults(snapshot: Snapshot, options: ResultOptions): string {
  const colors = new Map(snapshot.bots.map((bot) => [bot.id, bot.color]));
  return renderResults(matchRows(snapshot), snapshot.config.seed, { ...options, colors });
}

/** Colors follow the engine's participant order, so tournament rows match their arena tokens. */
export function colorsByOrder(botOrder: readonly string[]): Map<string, string> {
  return new Map(botOrder.map((id, index) => [id, BOT_COLORS[index % BOT_COLORS.length]!]));
}

export function renderPodium(rows: ResultRow[], options: ResultOptions = {}): string {
  const ranked = rankedResults(rows, options).slice(0, 3);
  const tournament = options.mode === "tournament";
  const places = ranked.map((row, index) => {
    const color = options.colors?.get(row.id) ?? "#c9eca1";
    const detail = tournament ? `${row.wins ?? 0} round wins` : `${row.delivered} items banked`;
    return `<li class="podium-place place-${index + 1}" style="--bot-color:${color}">
      <span class="podium-token">${escapeHtml(botMonogram(row.name))}</span>
      <strong>${escapeHtml(row.name)}</strong>
      <span class="podium-score">${row.score}<small> pts</small></span>
      <small>${detail}</small>
      <span class="podium-step">${index + 1}</span>
    </li>`;
  });

  return `<ol class="podium">${places.join("")}</ol>`;
}

export function renderResults(
  rows: ResultRow[],
  seed: string,
  options: ResultOptions = {},
): string {
  const mode = options.mode ?? "match";
  const columns = resultColumns(mode !== "match").filter(
    ({ label }) => !options.hiddenColumns?.has(label),
  );
  const sorted = rankedResults(rows, options);
  const body = sorted.map((row) => [
    `<th scope="row">${escapeHtml(row.name)}</th>`,
    ...columns.map(({ count }) => `<td>${escapeHtml(count(row) ?? "—")}</td>`),
  ]);
  const table = renderTable(["Bot", ...columns.map(({ label }) => label)], body);
  if (mode === "in-progress") return table;

  const podium = options.podium === false ? "" : renderPodium(rows, options);
  return podium + "<h3>Standings</h3>" + table + renderAwards(rows, seed, options.badges);
}

function rankedResults(rows: ResultRow[], options: ResultOptions): ResultRow[] {
  const tournament = options.mode === "tournament" || options.mode === "in-progress";
  const compare = tournament
    ? compareTournamentStandings
    : (first: ResultRow, second: ResultRow) => second.score - first.score;
  return [...rows].sort(compare);
}

function resultColumns(tournament: boolean) {
  return [
    { label: tournament ? "Total points" : "Points", count: (row: ResultRow) => row.score },
    ...(tournament
      ? [
          { label: "Round wins", count: (row: ResultRow) => row.wins },
          { label: "Badges", count: (row: ResultRow) => row.badges },
        ]
      : []),
    { label: "Tiles walked", count: (row: ResultRow) => row.statistics?.tilesWalked },
    { label: "Gathered", count: (row: ResultRow) => row.statistics?.gathered },
    { label: "Items banked", count: (row: ResultRow) => row.delivered },
    { label: "Guardians defeated", count: (row: ResultRow) => row.statistics?.guardiansDefeated },
    { label: "Captures", count: (row: ResultRow) => row.captures },
    { label: "Stolen", count: (row: ResultRow) => row.stolen },
    { label: "Sabotages", count: (row: ResultRow) => row.statistics?.sabotages },
    { label: "Traps triggered", count: (row: ResultRow) => row.statistics?.trapsTriggered },
    { label: "Errors", count: (row: ResultRow) => row.errors },
  ];
}

export const configurableResultColumns = resultColumns(false)
  .slice(1)
  .map(({ label }) => label);

interface ScoreRow {
  id: string;
  name: string;
  score: number;
}

export function renderScoreProgress(
  rows: ScoreRow[],
  colors?: ReadonlyMap<string, string>,
): string {
  const sorted = [...rows].sort((first, second) => second.score - first.score);
  const best = Math.max(1, sorted[0]?.score ?? 0);
  const bars = sorted.map(({ id, name, score }) => {
    const color = colors?.get(id) ?? "#c9eca1";
    return `<li style="--bot-color:${color}"><span>${escapeHtml(name)}</span>
      <div class="score-bar"><i style="width:${(score / best) * 100}%"></i></div><b>${escapeHtml(score)}</b></li>`;
  });

  return `<ol class="score-bars" aria-label="Points at this tick">${bars.join("")}</ol>`;
}

function renderTable(headers: string[], rows: string[][]): string {
  return `<div class="results-table-wrap"><table class="results-table">
    <thead><tr>${headers.map((header) => `<th scope="col">${header}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((cells) => `<tr>${cells.join("")}</tr>`).join("")}</tbody>
  </table></div>`;
}

function renderAwards(rows: ResultRow[], seed: string, options?: BadgeOptions): string {
  const { prominent, extras } = selectAwards(rows, seed, options);
  const hasBadges = prominent.length || extras.length;
  if (!hasBadges) return "";

  return (
    (prominent.length ? "<h3>Standout badges</h3>" + renderAwardList(prominent) : "") +
    (extras.length ? "<h3>Random badges</h3>" + renderAwardList(extras) : "")
  );
}

function renderAwardList(awards: ReturnType<typeof selectAwards>["prominent"]): string {
  const cards = awards.map(
    ({ title, icon, theme, winners, value }) =>
      `<li><span class="award-badge award-${theme}" aria-hidden="true">${icon}</span><div><strong>${title}</strong><span>${winners.map(({ name }) => escapeHtml(name)).join(", ")} · ${value}</span></div></li>`,
  );
  return `<ul class="achievement-list">${cards.join("")}</ul>`;
}
