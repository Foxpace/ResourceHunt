import { matchRows } from "../../competition/results.ts";
import type { Snapshot } from "../../engine/types.ts";
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
}

export function renderMatchResults(snapshot: Snapshot, options: ResultOptions): string {
  return renderResults(matchRows(snapshot), snapshot.config.seed, options);
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
  const sorted = [...rows].sort((first, second) => second.score - first.score);
  const body = sorted.map((row) => [
    `<th scope="row">${escapeHtml(row.name)}</th>`,
    ...columns.map(({ count }) => `<td>${escapeHtml(count(row) ?? "—")}</td>`),
  ]);
  const table = renderTable(["Bot", ...columns.map(({ label }) => label)], body);
  return mode === "in-progress" ? table : table + renderAwards(rows, seed, options.badges);
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

export function renderScoreProgress(rows: { name: string; score: number }[]): string {
  const sorted = [...rows].sort((first, second) => second.score - first.score);
  return renderTable(
    ["Bot", "Points"],
    sorted.map(({ name, score }) => [
      `<th scope="row">${escapeHtml(name)}</th>`,
      `<td>${escapeHtml(score)}</td>`,
    ]),
  );
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
