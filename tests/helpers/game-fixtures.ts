import { CLASSIC_WORLD_RULES } from "../../src/engine/world/types.ts";
import type { TestContext } from "node:test";
import { Game } from "../../src/engine/game.ts";
import { normalizeConfig } from "../../src/engine/config.ts";
import { findPath } from "../../src/engine/pathfinding.ts";
import type {
  BotController,
  GameConfig,
  Observation,
  Snapshot,
  Action,
} from "../../src/engine/types.ts";
import type { Position } from "../../src/sdk.ts";

export const TEST_CONFIG = {
  ...CLASSIC_WORLD_RULES,
  width: 13,
  height: 13,
  seed: "rules",
  ticks: 10,
};

export function createBotController(
  id: string,
  decide: (state: Observation) => unknown,
): BotController {
  return {
    metadata: { id, name: id, description: "Test bot" },
    async decide(state) {
      return { action: decide(state) };
    },
    dispose() {},
  };
}

interface GameFixtureOptions {
  bots?: BotController[];
  enableWorld?: boolean;
  config?: Partial<GameConfig>;
}

export function createGame(context: TestContext, options: GameFixtureOptions = {}): Game {
  const bots = options.bots ?? [createBotController("test", () => ({ type: "skip" }))];
  const game = new Game(bots, {
    ...TEST_CONFIG,
    ...options.config,
    ...(options.enableWorld ? {} : CLASSIC_WORLD_RULES),
  });
  context.after(() => game.dispose());

  return game;
}

export async function advanceGame(game: Game, turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn++) await game.step();
}

export async function advanceUntil(
  game: Game,
  condition: (snapshot: Snapshot) => boolean,
): Promise<void> {
  for (let turn = 0; turn < 200; turn++) {
    const snapshot = game.snapshot();
    if (condition(snapshot)) return;
    if (snapshot.finished) throw new Error("Match ended before reaching the expected state");

    await game.step();
  }
  throw new Error("Game did not reach the expected state within 200 turns");
}

export function createObservationFromSnapshot(snapshot: Snapshot, id: string): Observation {
  return {
    ...snapshot,
    self: snapshot.bots.find((bot) => bot.id === id)!,
    maxTicks: snapshot.config.ticks,
    remainingTicks: snapshot.config.ticks - snapshot.tick,
    capacity: snapshot.config.capacity,
  };
}

export function moveToward(state: Observation, target: Position): Action {
  const direction = findPath(state.map, state.self.position, target)?.steps[0];

  return direction ? { type: "move", direction } : { type: "skip" };
}

export function createMatchRequest(seed = "test", overrides: Partial<GameConfig> = {}) {
  return {
    botIds: ["test"],
    config: normalizeConfig({ ...TEST_CONFIG, ticks: 3, seed, ...overrides }),
  };
}

export function createActionSequenceGame(
  context: TestContext,
  actions: unknown[],
  config: Partial<GameConfig> = {},
): Game {
  const bot = createBotController("test", (state) => actions[state.tick] ?? { type: "skip" });

  return createGame(context, { bots: [bot], config });
}

export function createCountingBot() {
  const activity = { decisions: 0, disposed: false };
  const bot = createBotController("test", (state) => {
    activity.decisions++;

    return state.tick ? { type: "grab" } : { type: "move", direction: "S" };
  });
  bot.dispose = () => {
    activity.disposed = true;
  };

  return { bot, activity };
}

export function createTurnOrderBots() {
  const observations: string[] = [];
  const bots = ["a", "b", "c"].map((id) =>
    createBotController(id, (state) => {
      const previousActions = state.bots.filter((bot) => bot.lastAction === "Skipped").length;
      observations.push(`${state.tick}:${id}:${previousActions}`);

      return { type: "skip" };
    }),
  );

  return { bots, observations };
}
