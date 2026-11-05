import type { Frame } from "../engine/types.ts";

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
