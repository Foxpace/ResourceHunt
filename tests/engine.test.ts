import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMap, normalizeConfig, findPath, parseReplay, samePosition } from "../src/index.ts";
import { randomFromSeed } from "../src/engine/random.ts";
import {
  createActionSequenceGame,
  createBotController,
  createCountingBot,
  createGame,
  createTurnOrderBots,
  advanceGame,
  TEST_CONFIG,
} from "./helpers/game-fixtures.ts";
import { createMap } from "./helpers/sdk-fixtures.ts";
import { createMapScenarios, numberedSeeds } from "./helpers/map-fixtures.ts";
import { assertMapReachable } from "./helpers/map-assertions.ts";
import { createTerrainTravel } from "./helpers/terrain-travel.ts";

const collectionActions = [
  { type: "move", direction: "S" },
  { type: "grab" },
  { type: "grab" },
  { type: "home" },
];

test("identical seeds reproduce the same map", () => {
  // Given
  const config = normalizeConfig(TEST_CONFIG);

  // When
  const first = generateMap(config, 4);
  const repeated = generateMap(config, 4);

  // Then
  assert.deepEqual(first, repeated);
  assert.notDeepEqual(first, generateMap({ ...config, seed: "other" }, 4));
});

test("identical seeds reproduce the same random sequence", () => {
  // Given
  const firstRandom = randomFromSeed("test");
  const repeatedRandom = randomFromSeed("test");

  // When
  const first = Array.from({ length: 100 }, firstRandom);
  const repeated = Array.from({ length: 100 }, repeatedRandom);

  // Then
  assert.deepEqual(first, repeated);
});

for (const scenario of createMapScenarios({
  dimensions: [[13, 13]],
  botCounts: [8],
  seeds: numberedSeeds("", 24),
})) {
  test(`all land and resources are connected: ${scenario.label}`, () => {
    // Given
    const { config, botCount } = scenario;

    // When
    const generated = generateMap(config, botCount);

    // Then
    assert.equal(generated.bases.length, botCount);
    assertMapReachable(generated);
  });
}

for (const scenario of [
  {
    name: "weighted routes",
    middle: "mountain" as const,
    target: { x: 2, y: 0 },
    expected: { cost: 4, steps: ["E", "E"] },
  },
  {
    name: "river detours",
    middle: "water" as const,
    target: { x: 2, y: 0 },
    expected: { cost: 4, steps: ["S", "E", "E", "N"] },
  },
  {
    name: "already being home",
    middle: "grass" as const,
    target: { x: 0, y: 0 },
    expected: { cost: 0, steps: [] },
  },
  {
    name: "out-of-bounds targets",
    middle: "grass" as const,
    target: { x: -1, y: 0 },
    expected: null,
  },
]) {
  test(`pathfinding handles ${scenario.name}`, () => {
    // Given
    const map = createMap([
      ["grass", scenario.middle, "grass"],
      ["grass", "grass", "grass"],
    ]);

    // When
    const route = findPath(map, { x: 0, y: 0 }, scenario.target);

    // Then
    assert.deepEqual(route, scenario.expected);
  });
}

for (const invalidConfig of [
  { width: 12 },
  { ticks: 0 },
  { capacity: 2 },
  { terrainDensity: NaN },
  { seed: "" },
  { decisionTimeoutMs: 1 },
]) {
  test(`configuration rejects ${Object.keys(invalidConfig)[0]} outside its allowed range`, () => {
    // Given
    const input = invalidConfig;

    // When
    const normalize = () => normalizeConfig(input);

    // Then
    assert.throws(normalize);
  });
}

for (const turns of [1, 2, 3]) {
  test(`collecting for ${turns} turns respects one-unit grabs and capacity`, async (context) => {
    // Given
    const game = createActionSequenceGame(context, collectionActions, { capacity: 3 });
    const initialBase = game.snapshot().bots[0]!.base;

    // When
    await advanceGame(game, turns);
    const bot = game.snapshot().bots[0]!;

    // Then
    assert.equal(bot.position.y, initialBase.y + 1);
    assert.deepEqual(bot.inventory, turns === 1 ? [] : ["crystal"]);
    assert.equal(game.result().standings[0]!.score, 0);
  });
}

test("returning home banks collected resources", async (context) => {
  // Given
  const game = createActionSequenceGame(context, collectionActions, { capacity: 3 });

  // When
  await advanceGame(game, 4);
  const bot = game.snapshot().bots[0]!;

  // Then
  assert.partialDeepStrictEqual(game.result().standings[0], {
    score: 7,
    delivered: 1,
    carriedValue: 0,
  });
  assert.ok(samePosition(bot.position, bot.base));
});

test("the deadline stops decisions and leaves carried value unscored", async (context) => {
  // Given
  const { bot, activity } = createCountingBot();
  const game = createGame(context, { bots: [bot], config: { ticks: 2 } });

  // When
  await advanceGame(game, 3);

  // Then
  assert.deepEqual(activity, { decisions: 2, disposed: true });
  assert.partialDeepStrictEqual(game.result().standings[0], { score: 0, carriedValue: 7 });
  assert.equal(game.snapshot().finished, true);
});

test("initiative rotates and later decisions see earlier actions", async (context) => {
  // Given
  const { bots, observations } = createTurnOrderBots();
  const game = createGame(context, { bots, config: { ticks: 3 } });

  // When
  await advanceGame(game, 3);

  // Then
  assert.deepEqual(observations.slice(0, 3), ["0:a:0", "0:b:1", "0:c:2"]);
  assert.deepEqual(
    observations.map((entry) => entry.slice(0, 3)),
    ["0:a", "0:b", "0:c", "1:b", "1:c", "1:a", "2:c", "2:a", "2:b"],
  );
  assert.deepEqual(
    game.result().standings.map((bot) => bot.rank),
    [1, 1, 1],
  );
});

test("mutating observations and returned snapshots cannot change engine state", async (context) => {
  // Given
  const bot = createBotController("test", (state) => {
    state.self.score = 999;
    state.map.tiles[0]![0] = "water";
    state.resources.length = 0;
    return { type: "skip" };
  });
  const game = createGame(context, { bots: [bot] });
  game.snapshot().bots[0]!.score = 100;

  // When
  await game.step();

  // Then
  assert.equal(game.result().standings[0]!.score, 0);
  assert.ok(game.snapshot().resources.length > 0);
});

test("invalid actions and exceptions consume turns and report errors", async (context) => {
  // Given
  const bot = createBotController("test", (state) => {
    if (state.tick === 1) throw new Error("broken strategy");
    return { type: "move", direction: "__proto__" };
  });
  const game = createGame(context, { bots: [bot], config: { ticks: 2 } });

  // When
  await advanceGame(game, 2);

  // Then
  assert.equal(game.result().standings[0]!.errors, 2);
  assert.equal(game.snapshot().events[0]!.message, "broken strategy");
});

test("mountain travel consumes two waiting turns before the next decision", async (context) => {
  // Given
  const { game, traveler, remaining } = await createTerrainTravel(context, {
    biome: "riverlands",
    terrain: "mountain",
  });
  const decisionsAtArrival = traveler.decisions;

  // When
  await advanceGame(game, remaining);
  const decisionsAfterWaiting = traveler.decisions;
  await game.step();

  // Then
  assert.equal(remaining, 2);
  assert.equal(decisionsAfterWaiting, decisionsAtArrival);
  assert.equal(traveler.decisions, decisionsAtArrival + 1);
});

test("a replay preserves the initial state and every tick", async (context) => {
  // Given
  const game = createGame(context, { config: { ticks: 3 } });
  await advanceGame(game, 3);

  // When
  const replay = parseReplay(JSON.parse(JSON.stringify(game.replay())));

  // Then
  assert.equal(replay.initial.tick, 0);
  assert.deepEqual(
    replay.frames.map((frame) => frame.tick),
    [1, 2, 3],
  );
});

test("replay parsing rejects corrupt coordinates", async (context) => {
  // Given
  const game = createGame(context);
  await game.step();
  const replay = game.replay();
  replay.frames[0]!.bots[0]!.position.x = -1;

  // When
  const importReplay = () => parseReplay(replay);

  // Then
  assert.throws(importReplay);
});
