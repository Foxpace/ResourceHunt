import { MAX_BOTS } from "../engine/types.ts";
import type { GameConfig, MatchResult } from "../engine/types.ts";
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
}

export interface BenchmarkResult {
  matches: number;
  config: GameConfig;
  standings: BenchmarkStanding[];
  results: MatchResult[];
}

/** Rotate every bot through every base before moving to the next map seed. */
export async function runBenchmark(
  bots: BotDescriptor[],
  config: GameConfig,
  matches: number,
  onProgress?: (completed: number) => void,
): Promise<BenchmarkResult> {
  if (!Number.isInteger(matches) || matches < 1 || matches > 10000) {
    throw new Error("matches must be an integer between 1 and 10000");
  }
  if (bots.length < 1 || bots.length > MAX_BOTS)
    throw new Error(`Select between 1 and ${MAX_BOTS} bots`);

  const results: MatchResult[] = [];
  for (let index = 0; index < matches; index++) {
    const shift = index % bots.length;
    const lineup = [...bots.slice(shift), ...bots.slice(0, shift)];
    const seed = `${config.seed}:${Math.floor(index / bots.length)}`;
    const game = await createGame(lineup, { ...config, seed }, false);

    try {
      await runToEnd(game);
      results.push(game.result());
    } finally {
      game.dispose();
    }
    onProgress?.(index + 1);
  }

  const standings = bots.map((bot) => summarizeBot(bot, results));
  standings.sort((a, b) => b.meanScore - a.meanScore);
  return { matches, config, standings, results };
}

function summarizeBot(bot: BotDescriptor, results: MatchResult[]): BenchmarkStanding {
  const rows = results.map((result) => result.standings.find((row) => row.id === bot.id)!);
  const scores = rows.map((row) => row.score);
  return {
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
