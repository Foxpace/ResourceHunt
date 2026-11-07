import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseReplay,
  getBankingSites,
  CLASSIC_WORLD_RULES,
  normalizeConfig,
} from "../src/index.ts";
import { PlaybackTimeline } from "../src/web/model/playback-timeline.ts";
import { configFromFlags, parseArguments } from "../src/cli/options.ts";
import {
  createWorldGame,
  recordWorldReplay,
  assertForecastSafety,
  removeLegacyWorld,
  createSabotageMatch,
} from "./helpers/world-integration.ts";
import {
  advanceGame,
  advanceUntil,
  createBotController,
  createObservationFromSnapshot,
} from "./helpers/game-fixtures.ts";

for (const [biome, expectedKind] of [
  ["riverlands", "storm"],
  ["valley", "storm"],
  ["desert", "sandstorm"],
  ["moon", "meteors"],
  ["volcanic", "lava"],
  ["archipelago", "squall"],
  ["tundra", "blizzard"],
  ["forest", "storm"],
] as const) {
  test(`${biome} forecasts its own natural event outside protected starts`, (context) => {
    // Given
    const game = createWorldGame(context, { config: { biome } });

    // When
    const snapshot = game.snapshot();

    // Then
    assert.equal(snapshot.world.hazards[0]!.kind, expectedKind);
    assertForecastSafety(snapshot);
  });
}

test("volcanoes alternate lava surges and falling boulders", async (context) => {
  // Given
  const replay = await recordWorldReplay(context, { biome: "volcanic" });

  // When
  const kinds = new Set(
    [replay.initial, ...replay.frames].flatMap((frame) =>
      frame.world.hazards.map((hazard) => hazard.kind),
    ),
  );

  // Then
  assert.deepEqual(kinds, new Set(["lava", "boulders"]));
});

test("new matches enable the competitive world by default", (context) => {
  // Given
  const game = createWorldGame(context);

  // When
  const snapshot = game.snapshot();

  // Then
  assert.equal(snapshot.config.sabotage, true);
  assert.equal(snapshot.config.cargoTraps, true);
  assert.equal(snapshot.world.drones.length, 2);
  assert.equal(snapshot.world.caches.length, 2);
});

test("the first bot decision sees the guardian's first patrol move", async (context) => {
  // Given
  let nextGuardianMoveTick: number | undefined;
  const bot = createBotController("test", (state) => {
    nextGuardianMoveTick = state.world.caches[0]?.nextGuardianMoveTick;
    return { type: "skip" };
  });
  const game = createWorldGame(context, { bots: [bot] });

  // When
  await game.step();

  // Then
  assert.equal(nextGuardianMoveTick, 2);
});

test("the bot decision on tick six sees the scavenger's first patrol move", async (context) => {
  // Given
  let nextDroneMoveTick: number | undefined;
  const bot = createBotController("test", (state) => {
    nextDroneMoveTick = state.world.drones[0]?.nextMoveTick;
    return { type: "skip" };
  });
  const game = createWorldGame(context, { bots: [bot] });

  // When
  await advanceGame(game, 7);

  // Then
  assert.equal(nextDroneMoveTick, 9);
});

for (const [hotspotCount, guardianCount] of [
  [0, 2],
  [1, 4],
  [3, 1],
] as const) {
  test(`guardian placement with ${hotspotCount} hotspots and ${guardianCount} guardians`, (context) => {
    // Given
    const game = createWorldGame(context, { config: { hotspotCount, guardianCount } });

    // When
    const { hotspots, world } = game.snapshot();

    // Then
    assert.equal(hotspots.length, hotspotCount);
    assert.equal(world.caches.length, Math.min(hotspotCount, guardianCount));
    const expected = hotspots.slice(0, guardianCount).map(({ x, y }) => ({ x, y }));
    assert.deepEqual(
      world.caches.map((cache) => cache.position),
      expected,
    );
    assert.deepEqual(
      world.caches.map((cache) => cache.guardianPosition),
      expected,
    );
  });
}

test("classic settings explicitly disable new world mechanics", (context) => {
  // Given
  const game = createWorldGame(context, { config: CLASSIC_WORLD_RULES });

  // When
  const world = game.snapshot().world;

  // Then
  assert.deepEqual(world.drones, []);
  assert.deepEqual(world.caches, []);
  assert.deepEqual(world.hazards, []);
});

test("identical seeds reproduce enemy movement, weather, stock, and events", async (context) => {
  // Given
  const first = await recordWorldReplay(context);

  // When
  const repeated = await recordWorldReplay(context);

  // Then
  assert.deepEqual(first, repeated);
});

test("world state and visual events survive JSON replay export and import", async (context) => {
  // Given
  const original = await recordWorldReplay(context);

  // When
  const imported = parseReplay(JSON.parse(JSON.stringify(original)));

  // Then
  assert.deepEqual(imported, original);
  assert.ok(imported.frames.some((frame) => frame.events.some((event) => event.kind === "world")));
});

test("replay scrubbing restores lava and its cleared underlying terrain", async (context) => {
  // Given
  const replay = await recordWorldReplay(context, { biome: "volcanic" });
  const timeline = new PlaybackTimeline();
  timeline.loadRecordedReplay(replay);
  const cell = replay.initial.world.hazards[0]!.cells[0]!;

  // When
  timeline.seekRecordedFrame(18);
  const activeTerrain = timeline.snapshot!.map.tiles[cell.y]![cell.x];
  timeline.seekRecordedFrame(25);

  // Then
  assert.equal(activeTerrain, "lava");
  assert.equal(
    timeline.snapshot!.map.tiles[cell.y]![cell.x],
    replay.initial.map.tiles[cell.y]![cell.x],
  );
});

test("legacy replays import with empty world state and disabled new rules", async (context) => {
  // Given
  const legacy = removeLegacyWorld(await recordWorldReplay(context));

  // When
  const imported = parseReplay(legacy);

  // Then
  assert.deepEqual(imported.initial.world.hazards, []);
  assert.deepEqual(imported.initial.world.drones, []);
  assert.partialDeepStrictEqual(imported.initial.config, CLASSIC_WORLD_RULES);
  assert.equal(legacy.initial.world, undefined);
});

test("mutating a published enemy snapshot cannot change the game", (context) => {
  // Given
  const game = createWorldGame(context);
  const published = game.snapshot();

  // When
  published.world.drones[0]!.health = 0;
  published.world.caches[0]!.inventory = [];
  published.world.hazards[0]!.cells = [];

  // Then
  assert.equal(game.snapshot().world.drones[0]!.health, 2);
  assert.equal(game.snapshot().world.caches[0]!.inventory.length, 4);
  assert.ok(game.snapshot().world.hazards[0]!.cells.length > 0);
});

test("real bot actions sabotage a captured depot and remove its banking access", async (context) => {
  // Given
  const game = createSabotageMatch(context);

  // When
  await advanceUntil(
    game,
    (snapshot) => (snapshot.outposts[0]!.disabledUntilTick ?? 0) > snapshot.tick,
  );
  const defender = createObservationFromSnapshot(game.snapshot(), "defender");

  // Then
  assert.equal(getBankingSites(defender).length, 1);
  assertSabotageStatistics(game);
  assert.ok(game.snapshot().bots.every((bot) => bot.errors === 0));
  assert.deepEqual(parseReplay(game.replay()), game.replay());
});

function assertSabotageStatistics(game: ReturnType<typeof createSabotageMatch>) {
  const standings = game.result().standings;
  assert.equal(standings.find((bot) => bot.id === "defender")!.statistics!.depotOfflineTicks, 1);
  const attacker = standings.find((bot) => bot.id !== "defender")!;
  assert.equal(attacker.statistics!.sabotageAttempts, 1);
  assert.equal(attacker.statistics!.sabotages, 1);

  const replay = parseReplay(JSON.parse(JSON.stringify(game.replay())));
  const timeline = new PlaybackTimeline();
  timeline.loadRecordedReplay(replay);
  assert.equal(timeline.snapshot!.statistics![attacker.id]!.sabotages, 0);
  timeline.seekRecordedFrame(replay.frames.length);
  assert.deepEqual(timeline.snapshot!.statistics![attacker.id], attacker.statistics);
  assert.equal(timeline.snapshot!.statistics!.defender!.sabotages, 0);

  for (const frame of [replay.initial, ...replay.frames]) delete frame.statistics;
  timeline.loadRecordedReplay(parseReplay(replay));
  assert.equal(timeline.snapshot!.statistics, undefined);
}

test("CLI flags configure each new mechanic", () => {
  // Given
  const argumentsList =
    "play --sabotage false --cargo-traps false --scavengers 3 --guardians 1 --natural-events false".split(
      " ",
    );

  // When
  const config = configFromFlags(parseArguments(argumentsList).flags);

  // Then
  assert.partialDeepStrictEqual(config, {
    sabotage: false,
    cargoTraps: false,
    scavengerCount: 3,
    guardianCount: 1,
    naturalEvents: false,
  });
});

for (const invalid of [
  { scavengerCount: 7 },
  { guardianCount: -1 },
  { naturalEvents: "yes" },
  { sabotage: null },
  { cargoTraps: 1 },
]) {
  test(`configuration rejects invalid ${Object.keys(invalid)[0]}`, () => {
    // Given
    const input = invalid as unknown as Parameters<typeof normalizeConfig>[0];

    // When
    const configure = () => normalizeConfig(input);

    // Then
    assert.throws(configure);
  });
}
