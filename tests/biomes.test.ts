import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMap, normalizeConfig, parseReplay, terrainCost } from "../src/index.ts";
import { configFromFlags, parseArguments } from "../src/cli/options.ts";
import { minimumMapSize } from "../src/engine/map-layout.ts";
import {
  BIOME_IDS,
  createMapScenarios,
  MAP_DIMENSIONS,
  numberedSeeds,
} from "./helpers/map-fixtures.ts";
import {
  assertMapReachable,
  assertOpeningSupplies,
  assertStartingTerrain,
} from "./helpers/map-assertions.ts";
import { assertBiomeTerrain, assertIslandCrossings } from "./helpers/biome-assertions.ts";
import { createTerrainTravel } from "./helpers/terrain-travel.ts";
import { advanceGame, createGame } from "./helpers/game-fixtures.ts";

for (const biome of BIOME_IDS) {
  test(`${biome} terrain is reproducible and changes with the seed`, () => {
    // Given
    const config = normalizeConfig({ biome, seed: "biome-templates" });

    // When
    const generated = generateMap(config, 4);
    const repeated = generateMap(config, 4);
    const different = generateMap({ ...config, seed: "other" }, 4);

    // Then
    assert.deepEqual(generated, repeated);
    assert.notDeepEqual(generated.map, different.map);
    assertBiomeTerrain(generated.map, biome);
  });

  test(`the CLI accepts the ${biome} template`, () => {
    // Given
    const argumentsList = ["play", "--biome", biome];

    // When
    const config = configFromFlags(parseArguments(argumentsList).flags);

    // Then
    assert.equal(config.biome, biome);
  });

  test(`${biome} travel delays decisions by the terrain cost`, async (context) => {
    // Given
    const { game, traveler, remaining } = await createTerrainTravel(context, { biome });
    const decisionsAtArrival = traveler.decisions;

    // When
    await advanceGame(game, remaining);

    // Then
    assert.equal(remaining, terrainCost(game.snapshot().map, traveler.target!) - 1);
    assert.equal(traveler.decisions, decisionsAtArrival);
  });

  test(`${biome} decisions resume when travel finishes and its replay round-trips`, async (context) => {
    // Given
    const { game, traveler, remaining } = await createTerrainTravel(context, { biome });
    const decisionsAtArrival = traveler.decisions;
    await advanceGame(game, remaining);

    // When
    await game.step();
    const replay = game.replay();

    // Then
    assert.equal(traveler.decisions, decisionsAtArrival + 1);
    assert.equal(game.result().standings[0]!.errors, 0);
    assert.deepEqual(parseReplay(JSON.parse(JSON.stringify(replay))), replay);
  });
}

const reachabilityScenarios = createMapScenarios({
  biomes: BIOME_IDS,
  dimensions: MAP_DIMENSIONS,
  botCounts: [1, 4, 8],
  config: { hotspotCount: 6, outpostCount: 6 },
});
for (const scenario of reachabilityScenarios) {
  test(`all land and sites stay reachable: ${scenario.label}`, () => {
    // Given
    const { config, botCount } = scenario;

    // When
    const generated = generateMap(config, botCount);

    // Then
    assert.equal(generated.bases.length, botCount);
    assertMapReachable(generated);
    assertStartingTerrain(generated, config.biome);
  });
}

const crowdedScenarios = createMapScenarios({
  biomes: BIOME_IDS,
  botCounts: [10, 15],
  seeds: numberedSeeds("crowded-", 4),
});
for (const scenario of crowdedScenarios) {
  test(`crowded starts have separate supplies: ${scenario.label}`, () => {
    // Given
    const { config, botCount } = scenario;

    // When
    const generated = generateMap(config, botCount);

    // Then
    assertOpeningSupplies(generated);
    assert.equal(generated.bases.length, botCount);
    assertMapReachable(generated);
  });
}

const islandScenarios = createMapScenarios({
  biomes: ["archipelago"],
  botCounts: [1, 4, 8, 10, 15],
  dimensions: [
    [25, 25],
    [33, 33],
    [81, 81],
  ],
});
for (const scenario of islandScenarios) {
  test(`island crossings have equal lengths and equal base approaches: ${scenario.label}`, () => {
    // Given
    const { config, botCount } = scenario;

    // When
    const generated = generateMap(config, botCount);

    // Then
    assertIslandCrossings(generated);
  });
}

test("different biome templates produce different terrain", () => {
  // Given
  const configs = BIOME_IDS.map((biome) => normalizeConfig({ biome, seed: "biome-templates" }));

  // When
  const signatures = configs.map((config) => JSON.stringify(generateMap(config, 4).map.tiles));

  // Then
  assert.equal(new Set(signatures).size, BIOME_IDS.length);
});

test("Riverlands is the default and invalid biome names are rejected", () => {
  // Given
  const invalidBiome = { biome: "unknown" } as unknown as Parameters<typeof normalizeConfig>[0];

  // When
  const config = normalizeConfig();

  // Then
  assert.equal(config.biome, "riverlands");
  assert.throws(() => normalizeConfig(invalidBiome), /biome must be/);
  assert.throws(() => configFromFlags(new Map([["biome", "toString"]])), /biome must be/);
});

test("large lineups require room for balanced starts", () => {
  // Given
  const smallMap = normalizeConfig({ width: 13, height: 13 });

  // When
  const minimumSize = minimumMapSize(15, "valley");

  // Then
  assert.equal(minimumSize, 25);
  assert.throws(() => generateMap(smallMap, 15), /at least 25/);
  assert.throws(() => generateMap(normalizeConfig(), 16), /15 bots/);
});

test("legacy replays retain the Riverlands theme", async (context) => {
  // Given
  const game = createGame(context, { config: { ticks: 1 } });
  await game.step();
  const replay = game.replay();
  delete (replay.initial.config as Partial<typeof replay.initial.config>).biome;

  // When
  const imported = parseReplay(replay);

  // Then
  assert.equal(imported.initial.config.biome, "riverlands");
});
