import { randomFromSeed } from "../engine/random.ts";
import type { MatchStatistics } from "../engine/match-statistics.ts";

export interface AwardRow {
  id: string;
  name: string;
  score: number;
  delivered: number;
  captures: number;
  stolen: number;
  lost: number;
  statistics?: Partial<MatchStatistics>;
}

type Count = (row: AwardRow) => number | undefined;
const stat =
  (key: keyof MatchStatistics): Count =>
  (row) =>
    row.statistics?.[key];

type BadgeTheme = "gold" | "trail" | "cargo" | "combat" | "rival" | "survival";

const awardDefinitions: { title: string; icon: string; theme: BadgeTheme; count: Count }[] = [
  { title: "Top scorer", icon: "★", theme: "gold", count: (row) => row.score },
  {
    title: "Most guardians defeated",
    icon: "🐲",
    theme: "combat",
    count: stat("guardiansDefeated"),
  },
  { title: "Most tiles walked", icon: "👣", theme: "trail", count: stat("tilesWalked") },
  { title: "Most resources gathered", icon: "⛏", theme: "cargo", count: stat("gathered") },
  { title: "Most items banked", icon: "📦", theme: "cargo", count: (row) => row.delivered },
  { title: "Most banking trips", icon: "🏦", theme: "cargo", count: stat("deposits") },
  { title: "Most depots captured", icon: "🚩", theme: "rival", count: (row) => row.captures },
  { title: "Most items stolen", icon: "🧤", theme: "rival", count: (row) => row.stolen },
  { title: "Highest value stolen", icon: "💎", theme: "rival", count: stat("stolenValue") },
  { title: "Most sabotage attempts", icon: "🧨", theme: "rival", count: stat("sabotageAttempts") },
  { title: "Most rival depots sabotaged", icon: "💥", theme: "rival", count: stat("sabotages") },
  { title: "Most depot repairs", icon: "🔧", theme: "cargo", count: stat("repairs") },
  { title: "Most traps placed", icon: "🪤", theme: "rival", count: stat("trapsPlaced") },
  { title: "Most traps triggered", icon: "⚡", theme: "rival", count: stat("trapsTriggered") },
  { title: "Most traps cleared", icon: "✂", theme: "survival", count: stat("trapsCleared") },
  { title: "Most guardian hits", icon: "⚔", theme: "combat", count: stat("guardianStrikes") },
  { title: "Most cache items looted", icon: "🗝", theme: "cargo", count: stat("cacheLooted") },
  { title: "Most drone hits", icon: "🎯", theme: "combat", count: stat("droneStrikes") },
  { title: "Most cargo lost", icon: "🕳", theme: "survival", count: (row) => row.lost },
  {
    title: "Most guardian pushbacks endured",
    icon: "🛡",
    theme: "survival",
    count: stat("guardianRepels"),
  },
  { title: "Most drone stuns endured", icon: "🔋", theme: "survival", count: stat("droneStuns") },
  { title: "Most enemy traps sprung", icon: "⛓", theme: "survival", count: stat("trapsHit") },
  {
    title: "Most depot downtime endured",
    icon: "⏳",
    theme: "survival",
    count: stat("depotOfflineTicks"),
  },
  {
    title: "Most points per banking trip",
    icon: "🪙",
    theme: "gold",
    count: (row) => ratio(row.score, row.statistics?.deposits),
  },
  {
    title: "Most points per item banked",
    icon: "⚖",
    theme: "gold",
    count: (row) => ratio(row.score, row.delivered),
  },
  {
    title: "Most points per tile walked",
    icon: "🧭",
    theme: "trail",
    count: (row) => ratio(row.score, row.statistics?.tilesWalked),
  },
  {
    title: "Highest sabotage success percentage",
    icon: "📡",
    theme: "rival",
    count: (row) => percent(row.statistics?.sabotages, row.statistics?.sabotageAttempts),
  },
  {
    title: "Highest trap success percentage",
    icon: "🕸",
    theme: "rival",
    count: (row) => percent(row.statistics?.trapsTriggered, row.statistics?.trapsPlaced),
  },
  {
    title: "Most combined guardian and drone hits",
    icon: "🔱",
    theme: "combat",
    count: (row) => sum(row.statistics?.guardianStrikes, row.statistics?.droneStrikes),
  },
  {
    title: "Most items taken from rivals and caches",
    icon: "🎒",
    theme: "cargo",
    count: (row) => sum(row.stolen, row.statistics?.cacheLooted),
  },
];

function sum(first?: number, second?: number): number | undefined {
  if (first === undefined) return;
  if (second === undefined) return;

  return first + second;
}

function ratio(value: number, count?: number): number | undefined {
  return count ? Math.round((value / count) * 100) / 100 : undefined;
}

function percent(value?: number, count?: number): number | undefined {
  return value === undefined ? undefined : ratio(value * 100, count);
}

function earnedAward(rows: AwardRow[], definition: (typeof awardDefinitions)[number]) {
  const { title, icon, theme, count } = definition;
  const sorted = rows
    .map((row) => ({ id: row.id, name: row.name, value: count(row) ?? 0 }))
    .sort((first, second) => second.value - first.value);
  const best = sorted[0]?.value ?? 0;
  if (best <= 0) return [];

  const winners = sorted.filter(({ value }) => value === best);
  const lead = (best - (sorted[1]?.value ?? 0)) / best;
  return [{ title, icon, theme, winners, value: best, lead }];
}

export interface BadgeOptions {
  standout: number;
  random: number;
}

export const defaultBadgeOptions: BadgeOptions = { standout: 3, random: 5 };

export function selectAwards(rows: AwardRow[], seed: string, options = defaultBadgeOptions) {
  const earned = awardDefinitions.flatMap((definition) => earnedAward(rows, definition));
  earned.sort((first, second) => second.lead - first.lead);
  const prominent = earned.splice(0, options.standout);
  const random = randomFromSeed(seed);
  const extras = [];
  while (earned.length && extras.length < options.random) {
    extras.push(earned.splice(Math.floor(random() * earned.length), 1)[0]!);
  }
  return { prominent, extras };
}
