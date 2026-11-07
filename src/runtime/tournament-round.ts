import {
  tournamentBiomes,
  type TournamentRound,
  type TournamentRoundRequest,
} from "../competition/tournament.ts";
import type { Game } from "../engine/game.ts";
import { minimumMapSize } from "../engine/map-layout.ts";
import type { GameConfig } from "../engine/types.ts";
import type { BotDescriptor } from "./bots.ts";
import { createGame } from "./matches.ts";

export async function runTournamentRound(
  bots: BotDescriptor[],
  { config, roundIndex }: Pick<TournamentRoundRequest, "config" | "roundIndex">,
  signal: AbortSignal,
): Promise<TournamentRound> {
  signal.throwIfAborted();
  let game: Game | undefined;
  const cancel = () => game?.dispose();
  signal.addEventListener("abort", cancel, { once: true });

  try {
    game = await createTournamentGame(bots, config, roundIndex);
    signal.throwIfAborted();
    const scores: number[][] = [];
    await game.runToEnd((points) => scores.push(points));
    signal.throwIfAborted();
    return { result: game.result(), scores };
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
  }
}

function createTournamentGame(bots: BotDescriptor[], config: GameConfig, roundIndex: number) {
  const shift = roundIndex % bots.length;
  const minimum = Math.max(...tournamentBiomes.map((biome) => minimumMapSize(bots.length, biome)));
  return createGame(
    [...bots.slice(shift), ...bots.slice(0, shift)],
    { ...config, width: Math.max(config.width, minimum), height: Math.max(config.height, minimum) },
    false,
  );
}
