import { createMatchStatistics, type MatchStatistics } from "../engine/match-statistics.ts";
import { createBotLineup } from "./lineup.ts";
import { MAX_BOTS } from "../engine/types.ts";
import type { GameConfig, MatchResult, Standing } from "../engine/types.ts";
import type { BotDescriptor } from "./bots.ts";
import { createGame, runToEnd } from "./matches.ts";

export interface BenchmarkStanding {
  id: string;
  name: string;
  meanScore: number;
  meanRank: number;
  minScore: number;
  maxScore: number;
  wins: number;
  errors: number;
  captures: number;
  stolen: number;
  lost: number;
  meanOutpostsOwned: number;
  statistics: MatchStatistics;
}

export interface BenchmarkResult {
  matches: number;
  config: GameConfig;
  standings: BenchmarkStanding[];
  results: MatchResult[];
}

export interface BenchmarkOptions {
  matches: number;
  onProgress?: (completed: number) => void;
}

/** Rotate every bot through every base before moving to the next map seed. */
export async function runBenchmark(
  bots: BotDescriptor[],
  config: GameConfig,
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const { matches, onProgress } = options;

  const integerMatchCount = Number.isInteger(matches);
  const validMatchCount = integerMatchCount ? matches >= 1 && matches <= 10000 : false;
  if (!validMatchCount) {
    throw new Error("matches must be an integer between 1 and 10000");
  }

  const invalidBotCount = bots.length < 1 || bots.length > MAX_BOTS;
  if (invalidBotCount) throw new Error(`Select between 1 and ${MAX_BOTS} bots`);

  const lineup = createBotLineup(bots);
  const results: MatchResult[] = [];

  for (let index = 0; index < matches; index++) {
    results.push(await runBenchmarkMatch(lineup, config, index));
    onProgress?.(index + 1);
  }

  const standings = lineup.map((bot) => summarizeBot(bot, results));
  standings.sort((first, second) => second.meanScore - first.meanScore);

  return { matches, config, standings, results };
}

function summarizeBot(bot: BotDescriptor, results: MatchResult[]): BenchmarkStanding {
  const rows = results.map((result) => result.standings.find((row) => row.id === bot.id)!);
  const scores = rows.map((row) => row.score);

  return {
    statistics: sumStatistics(rows),
    id: bot.id,
    name: bot.name,
    meanScore: scores.reduce((sum, score) => sum + score, 0) / results.length,
    meanRank: rows.reduce((sum, row) => sum + row.rank, 0) / results.length,
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    wins: rows.filter((row) => row.rank === 1).length,
    errors: rows.reduce((sum, row) => sum + row.errors, 0),
    captures: rows.reduce((sum, row) => sum + row.captures, 0),
    stolen: rows.reduce((sum, row) => sum + row.stolen, 0),
    lost: rows.reduce((sum, row) => sum + row.lost, 0),
    meanOutpostsOwned: rows.reduce((sum, row) => sum + row.outpostsOwned, 0) / results.length,
  };
}

function sumStatistics(rows: Standing[]): MatchStatistics {
  const totals = createMatchStatistics();
  const keys = Object.keys(totals) as (keyof MatchStatistics)[];
  for (const { statistics } of rows) {
    if (!statistics) continue;
    for (const key of keys) totals[key] += statistics[key];
  }
  return totals;
}

async function createRotatedMatch(bots: BotDescriptor[], config: GameConfig, index: number) {
  const shift = index % bots.length;
  const lineup = [...bots.slice(shift), ...bots.slice(0, shift)];
  const seed = `${config.seed}:${Math.floor(index / bots.length)}`;

  return createGame(lineup, { ...config, seed }, false);
}

async function runBenchmarkMatch(
  bots: BotDescriptor[],
  config: GameConfig,
  index: number,
): Promise<MatchResult> {
  const game = await createRotatedMatch(bots, config, index);
  try {
    await runToEnd(game);
    return game.result();
  } finally {
    game.dispose();
  }
}
