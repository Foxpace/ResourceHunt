import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { DEFAULT_WORLD_RULES } from "../../src/engine/world/types.ts";
import { manhattanDistance } from "../../src/engine/grid.ts";
import type { BotController, GameConfig, Replay, Snapshot } from "../../src/engine/types.ts";
import { createBotController, createGame, moveToward, advanceGame } from "./game-fixtures.ts";

export function createWorldGame(
  context: TestContext,
  options: { config?: Partial<GameConfig>; bots?: BotController[] } = {},
) {
  return createGame(context, {
    enableWorld: true,
    bots: options.bots,
    config: {
      ...DEFAULT_WORLD_RULES,
      width: 33,
      height: 25,
      ticks: 48,
      seed: "world-replay",
      ...options.config,
    },
  });
}

export async function recordWorldReplay(
  context: TestContext,
  config: Partial<GameConfig> = {},
): Promise<Replay> {
  const game = createWorldGame(context, { config });
  await advanceGame(game, game.config.ticks);

  return game.replay();
}

export function assertForecastSafety(snapshot: Snapshot): void {
  const hazard = snapshot.world.hazards[0]!;
  assert.ok(hazard.startsAt - hazard.announcedAt >= 4);
  for (const cell of hazard.cells) {
    assert.ok(snapshot.bots.every((bot) => manhattanDistance(bot.base, cell) > 3));
    assert.notEqual(snapshot.map.tiles[cell.y]![cell.x], "bridge");
    assert.ok(!snapshot.outposts.some((outpost) => manhattanDistance(outpost, cell) === 0));
  }
}

export function removeLegacyWorld(replay: Replay) {
  const legacy = JSON.parse(JSON.stringify(replay));
  for (const frame of [legacy.initial, ...legacy.frames]) delete frame.world;
  for (const key of Object.keys(DEFAULT_WORLD_RULES)) delete legacy.initial.config[key];

  return legacy;
}

export function createSabotageMatch(context: TestContext) {
  const defender = createBotController("defender", (state) => {
    const outpost = state.outposts[0]!;
    if (outpost.ownerId === state.self.id) return { type: "skip" };
    if (manhattanDistance(state.self.position, outpost) === 0) return { type: "capture" };

    return moveToward(state, outpost);
  });
  const attacker = createBotController("attacker", (state) => {
    const outpost = state.outposts[0]!;
    if (!outpost.ownerId) return { type: "skip" };
    if (manhattanDistance(state.self.position, outpost) <= 1)
      return { type: "sabotage", targetId: outpost.id };

    return moveToward(state, outpost);
  });

  return createGame(context, {
    enableWorld: true,
    bots: [defender, attacker],
    config: { sabotage: true, outpostCount: 1, resourceDensity: 0, ticks: 100 },
  });
}

export function createRenderSnapshot(context: TestContext, tick = 0): Snapshot {
  const snapshot = createWorldGame(context).snapshot();
  snapshot.tick = tick;

  return snapshot;
}

const REPLAY_CORRUPTIONS: Record<string, (frame: Replay["frames"][number]) => void> = {
  "out-of-bounds hazard": (frame) => {
    frame.world.hazards[0]!.cells[0]!.x = 999;
  },
  "oversized hazard footprint": (frame) => {
    const hazard = frame.world.hazards[0]!;
    hazard.cells = Array.from({ length: 62 }, () => ({ ...hazard.center }));
  },
  "negative drone health": (frame) => {
    frame.world.drones[0]!.health = -1;
  },
  "out-of-bounds guardian position": (frame) => {
    frame.world.caches[0]!.guardianPosition = { x: -1, y: 0 };
  },
  "oversized guardian health": (frame) => {
    frame.world.caches[0]!.guardianHealth = 999;
  },
  "oversized cargo": (frame) => {
    frame.world.drones[0]!.inventory = Array(5).fill("ore");
  },
  "duplicate drone IDs": (frame) => {
    frame.world.drones[1]!.id = frame.world.drones[0]!.id;
  },
  "foreign guard owner": (frame) => {
    frame.world.defenses[0]!.botId = "intruder";
  },
  "out-of-bounds route": (frame) => {
    frame.world.drones[0]!.route = [{ x: -1, y: 0 }];
  },
  "missing frame world": (frame) => {
    delete (frame as Partial<typeof frame>).world;
  },
  "orphaned sabotage progress": (frame) => {
    frame.outposts[0]!.sabotageProgress = 1;
    frame.outposts[0]!.sabotagingBotId = null;
  },
  "foreign saboteur": (frame) => {
    frame.outposts[0]!.sabotageProgress = 1;
    frame.outposts[0]!.sabotagingBotId = "intruder";
  },
  "negative sabotage cooldown": (frame) => {
    frame.outposts[0]!.sabotageProtectedUntilTick = -1;
  },
  "negative depot downtime": (frame) => {
    frame.outposts[0]!.disabledUntilTick = -1;
  },
  "nonnumeric sabotage progress": (frame) => {
    frame.outposts[0]!.sabotageProgress = "1" as unknown as number;
  },
  "invalid hazard timing": (frame) => {
    frame.world.hazards[0]!.endsAt = 0;
  },
};

export function corruptWorldReplay(original: Replay, defect: string): Replay {
  const replay = structuredClone(original);
  REPLAY_CORRUPTIONS[defect]!(replay.frames[0]!);

  return replay;
}
