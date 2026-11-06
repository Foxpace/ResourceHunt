import type { Frame } from "../engine/types.ts";

export function compareTournamentStandings(
  first: { wins?: number; score: number },
  second: { wins?: number; score: number },
): number {
  return (second.wins ?? 0) - (first.wins ?? 0) || second.score - first.score;
}

export function matchRows(frame: Frame) {
  return frame.bots
    .map((bot) => ({
      id: bot.id,
      name: bot.name,
      score: bot.score,
      delivered: bot.delivered,
      captures: bot.captures,
      stolen: bot.stolen,
      lost: bot.lost,
      errors: bot.errors,
      statistics: frame.statistics?.[bot.id],
    }))
    .sort((first, second) => second.score - first.score);
}
