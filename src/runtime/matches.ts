import { Game } from "../engine/game.ts";
import type { GameConfig } from "../engine/types.ts";
import { createControllers, type BotDescriptor } from "./bots.ts";

export async function createGame(
  bots: BotDescriptor[],
  config: GameConfig,
  recordReplay = true,
): Promise<Game> {
  const controllers = await createControllers(bots, config);
  try {
    return new Game(controllers, config, { recordReplay });
  } catch (error) {
    controllers.forEach((controller) => controller.dispose());
    throw error;
  }
}
export async function runToEnd(game: Game) {
  for (let i = game.result().ticks; i < game.config.ticks; i++) await game.step();
}
