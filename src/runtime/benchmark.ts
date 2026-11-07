import { createHash } from "node:crypto";
import { createMatchStatistics, type MatchStatistics } from "../engine/match-statistics.ts";
import { MAX_SEED_LENGTH, normalizeConfig } from "../engine/config.ts";
import { createBotLineup } from "./lineup.ts";
import { MAX_BOTS } from "../engine/types.ts";
import type { GameConfig, MatchResult, Standing } from "../engine/types.ts";
import type { BotDescriptor } from "./bots.ts";
import { createGame } from "./matches.ts";
import { ActionTiming, type BotActionTiming } from "./action-timing.ts";

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
  results: BenchmarkMatchResult[];
  actionTiming?: BotActionTiming[];
}

interface BenchmarkMatchResult extends MatchResult {
  /** Tick zero onward. Columns follow botOrder. */
  scores?: number[][];
}

export interface BenchmarkOptions {
  matches: number;
  onProgress?: (completed: number) => void;
  scoreHistory?: boolean;
  actionTiming?: boolean;
}

interface BenchmarkMatchOptions {
  index: number;
  scoreHistory?: boolean;
  timing?: ActionTiming;
}

/** Rotate every bot through every base before moving to the next map seed. */
export async function runBenchmark(
  bots: BotDescriptor[],
  config: GameConfig,
  options: BenchmarkOptions,
): Promise<BenchmarkResult> {
  const { matches, onProgress, scoreHistory } = options;
  validateBenchmarkSize(matches, bots.length);

  const baseConfig = normalizeConfig(config);
  const lineup = createBotLineup(bots);
  const results: BenchmarkMatchResult[] = [];
  const timing = options.actionTiming ? new ActionTiming() : undefined;

  for (let index = 0; index < matches; index++) {
    results.push(await runBenchmarkMatch(lineup, baseConfig, { index, scoreHistory, timing }));
    onProgress?.(index + 1);
  }

  const standings = lineup.map((bot) => summarizeBot(bot, results));
  standings.sort((first, second) => second.meanScore - first.meanScore);

  const result = { matches, config: baseConfig, standings, results };
  if (!timing) return result;

  const ticks = results.reduce((sum, match) => sum + match.ticks, 0);
  return { ...result, actionTiming: standings.map(({ id }) => timing.summarize(id, ticks)) };
}

function validateBenchmarkSize(matches: number, botCount: number): void {
  const integerMatchCount = Number.isInteger(matches);
  const validMatchCount = integerMatchCount ? matches >= 1 && matches <= 10000 : false;
  if (!validMatchCount) throw new Error("matches must be an integer between 1 and 10000");

  const invalidBotCount = botCount < 1 || botCount > MAX_BOTS;
  if (invalidBotCount) throw new Error(`Select between 1 and ${MAX_BOTS} bots`);
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

async function createRotatedMatch(
  bots: BotDescriptor[],
  config: GameConfig,
  { index, timing }: BenchmarkMatchOptions,
) {
  const shift = index % bots.length;
  const lineup = [...bots.slice(shift), ...bots.slice(0, shift)];
  const seed = benchmarkMapSeed(config.seed, Math.floor(index / bots.length));

  const options = timing ? { recordReplay: false, wrapController: timing.wrap } : false;
  return createGame(lineup, { ...config, seed }, options);
}

function benchmarkMapSeed(seed: string, mapIndex: number): string {
  const suffix = `:${mapIndex}`;
  if (seed.length + suffix.length <= MAX_SEED_LENGTH) return seed + suffix;

  // Hash the whole seed so long seeds with a shared prefix still produce different maps.
  return createHash("sha256").update(seed).digest("hex") + suffix;
}

async function runBenchmarkMatch(
  bots: BotDescriptor[],
  config: GameConfig,
  match: BenchmarkMatchOptions,
): Promise<BenchmarkMatchResult> {
  const game = await createRotatedMatch(bots, config, match);
  const scores: number[][] = [];
  try {
    await game.runToEnd(match.scoreHistory ? (points) => scores.push(points) : undefined);
    const result = game.result();

    return match.scoreHistory ? { ...result, scores } : result;
  } finally {
    game.dispose();
  }
}
