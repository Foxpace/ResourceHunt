import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMap, normalizeConfig } from "../src/index.ts";
import {
  assertBalancedOpportunities,
  assertBiomeSiteAccess,
  assertCompetitionSites,
  assertHotspotVariety,
  assertSiteSpacing,
  calculateTravelCosts,
  createBarrierSiteScenario,
  createOpenSiteScenario,
  placeScenarioSites,
} from "./helpers/site-fixtures.ts";
import { BIOME_IDS, createMapScenarios, numberedSeeds } from "./helpers/map-fixtures.ts";
import { assertMapReachable } from "./helpers/map-assertions.ts";

for (const hotspotCount of [2, 4, 6]) {
  test(`${hotspotCount} hotspots share repeated opportunities across all players`, () => {
    // Given
    const scenario = createOpenSiteScenario(hotspotCount);

    // When
    const { hotspots, outposts } = placeScenarioSites(scenario);

    // Then
    for (const sites of [outposts, hotspots]) {
      assertBalancedOpportunities(
        calculateTravelCosts(scenario.setup.map, scenario.starts.bases, sites),
      );
    }
    assertSiteSpacing(scenario.starts.bases, [...outposts, ...hotspots]);
  });
}

test("sites account for routes around barriers rather than geometric proximity", () => {
  // Given
  const scenario = createBarrierSiteScenario();

  // When
  const { outposts } = placeScenarioSites(scenario);
  const costs = calculateTravelCosts(scenario.setup.map, scenario.starts.bases, outposts);

  // Then
  for (const [index, outpost] of outposts.entries()) {
    assert.ok(Math.abs(costs[0]![index]! - costs[1]![index]!) <= 4);
    assert.notEqual(scenario.setup.map.tiles[outpost.y]![outpost.x], "bridge");
  }
});

const fairnessScenarios = createMapScenarios({
  biomes: BIOME_IDS,
  layouts: ["edges"],
  seeds: numberedSeeds("sites-", 12),
});
for (const scenario of fairnessScenarios) {
  test(`sites keep clearance and share travel opportunities: ${scenario.label}`, () => {
    // Given
    const { config, botCount } = scenario;

    // When
    const generated = generateMap(config, botCount);

    // Then
    assertBiomeSiteAccess(generated, config.biome);
  });
}

const stockScenarios = createMapScenarios({
  dimensions: [
    [13, 13],
    [33, 33],
  ],
  botCounts: [1, 4, 8],
  config: { hotspotCount: 6, outpostCount: 6 },
});
for (const scenario of stockScenarios) {
  test(`competition sites are seeded, stocked, distinct, and reachable: ${scenario.label}`, () => {
    // Given
    const { config, botCount } = scenario;

    // When
    const generated = generateMap(config, botCount);
    const repeated = generateMap(config, botCount);

    // Then
    assert.deepEqual(generated, repeated);
    assertCompetitionSites(generated, config.biome);
    assertMapReachable(generated);
  });
}

test("disabling competition removes hotspots, outposts, and hotspot stock", () => {
  // Given
  const config = normalizeConfig({ hotspotCount: 0, outpostCount: 0, stealing: false });

  // When
  const generated = generateMap(config, 4);

  // Then
  assert.deepEqual(generated.hotspots, []);
  assert.deepEqual(generated.outposts, []);
  assert.ok(generated.resources.every((pile) => !pile.hotspotId));
});

test("disabling resources also removes hotspots", () => {
  // Given
  const config = normalizeConfig({ resourceDensity: 0 });

  // When
  const generated = generateMap(config, 4);

  // Then
  assert.deepEqual(generated.hotspots, []);
});

test("hotspot layouts vary with terrain and seeds while allowing outer sites", () => {
  // Given
  const scenarios = createMapScenarios({
    biomes: BIOME_IDS,
    layouts: ["edges"],
    seeds: numberedSeeds("sites-", 12),
    config: { hotspotCount: 4 },
  });

  // When
  const samples = scenarios.map(({ config, botCount }) => ({
    biome: config.biome,
    generated: generateMap(config, botCount),
  }));

  // Then
  assertHotspotVariety(samples);
});
