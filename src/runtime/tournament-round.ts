import { tournamentBiomes } from "../competition/tournament.ts";
import type { Game } from "../engine/game.ts";
import { minimumMapSize } from "../engine/map-layout.ts";
import type { GameConfig } from "../engine/types.ts";
import type { TournamentRound } from "../http/types.ts";
import type { BotDescriptor } from "./bots.ts";
import { createGame } from "./matches.ts";

export function createTournamentGame(
  bots: BotDescriptor[],
  config: GameConfig,
  roundIndex: number,
) {
  const shift = roundIndex % bots.length;
  const minimum = Math.max(...tournamentBiomes.map((biome) => minimumMapSize(bots.length, biome)));
  return createGame(
    [...bots.slice(shift), ...bots.slice(0, shift)],
    { ...config, width: Math.max(config.width, minimum), height: Math.max(config.height, minimum) },
    false,
  );
}

export async function recordTournamentScores(game: Game): Promise<TournamentRound> {
  const scores = [game.snapshot().bots.map((bot) => bot.score)];
  for (let tick = 0; tick < game.config.ticks; tick++) {
    const snapshot = await game.step();
    scores.push(snapshot.bots.map((bot) => bot.score));
  }
  return { result: game.result(), scores };
}
