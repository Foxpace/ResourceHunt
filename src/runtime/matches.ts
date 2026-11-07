import { Game } from "../engine/game.ts";
import type { BotController, GameConfig } from "../engine/types.ts";
import { createControllers, type BotDescriptor } from "./bots.ts";

interface MatchOptions {
  recordReplay?: boolean;
  wrapController?: (controller: BotController) => BotController;
}

export async function createGame(
  bots: BotDescriptor[],
  config: GameConfig,
  options: boolean | MatchOptions = true,
): Promise<Game> {
  const controllers = await createControllers(bots, config);
  try {
    const matchOptions = typeof options === "boolean" ? { recordReplay: options } : options;
    const { recordReplay, wrapController } = matchOptions;
    const lineup = wrapController ? controllers.map(wrapController) : controllers;
    return new Game(lineup, config, { recordReplay });
  } catch (error) {
    controllers.forEach((controller) => controller.dispose());
    throw error;
  }
}
export function runToEnd(game: Game): Promise<void> {
  return game.runToEnd();
}
