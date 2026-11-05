import assert from "node:assert/strict";
import {
  BIOMES,
  distanceField,
  normalizeConfig,
  positionKey,
  terrainCost,
} from "../../src/index.ts";
import { manhattanDistance } from "../../src/engine/grid.ts";
import { placeCompetitionSites } from "../../src/engine/maps/competition-map.ts";
import type { Biome, GameMap, Hotspot, Position } from "../../src/engine/types.ts";
import { createMap } from "./sdk-fixtures.ts";
import { BIOME_IDS, type GeneratedMap } from "./map-fixtures.ts";

export function createOpenSiteScenario(hotspotCount: number) {
  const map = createMap(Array.from({ length: 25 }, () => Array(33).fill("grass")));
  const bases = [
    { x: 16, y: 3 },
    { x: 29, y: 12 },
    { x: 16, y: 21 },
    { x: 3, y: 12 },
  ];
  const setup = { map, config: normalizeConfig({ hotspotCount, outpostCount: 2 }) };
  const starts = { bases, protectedCells: bases };

  return { setup, starts };
}

export function createBarrierSiteScenario() {
  const scenario = createOpenSiteScenario(0);
  for (const row of scenario.setup.map.tiles) row[16] = "water";
  scenario.setup.map.tiles[2]![16] = "bridge";
  const bases = [
    { x: 3, y: 12 },
    { x: 29, y: 12 },
  ];

  return { ...scenario, starts: { bases, protectedCells: bases } };
}

export function calculateTravelCosts(
  map: GameMap,
  bases: Position[],
  sites: Position[],
): number[][] {
  return bases.map((base) => {
    const arrivals = distanceField(map, base);

    return sites.map((site) => arrivals.get(positionKey(site))!.cost);
  });
}

export function assertBalancedOpportunities(costs: number[][]): void {
  const nearestCosts = costs.map((arrivals) => Math.min(...arrivals));
  const opportunities = costs.map(
    (arrivals) =>
      arrivals.filter((cost, siteIndex) => {
        const earliestArrival = Math.min(...costs.map((playerCosts) => playerCosts[siteIndex]!));

        return cost <= earliestArrival + 2;
      }).length,
  );
  assert.ok(Math.max(...nearestCosts) - Math.min(...nearestCosts) <= 2);
  assert.ok(Math.max(...opportunities) - Math.min(...opportunities) <= 1);
  assert.ok(opportunities.every((count) => count > 0));
}

export function assertSiteSpacing(bases: Position[], sites: Position[]): void {
  for (const [index, site] of sites.entries()) {
    assert.ok(bases.every((base) => manhattanDistance(base, site) >= 5));
    assert.ok(sites.slice(index + 1).every((other) => manhattanDistance(site, other) >= 4));
  }
}

export function assertBiomeSiteAccess(generated: GeneratedMap, biome: Biome): void {
  const { map, bases, hotspots, outposts, resources } = generated;
  for (const sites of [outposts, hotspots]) {
    const costs = calculateTravelCosts(map, bases, sites);
    const nearestCosts = costs.map((arrivals) => Math.min(...arrivals));
    const accessRatio = Math.max(...nearestCosts) / Math.min(...nearestCosts);
    const maximumRatio = biome === "forest" ? 2.5 : 1.4;
    assert.ok(accessRatio <= maximumRatio, `Uneven access ${accessRatio}`);
    for (const [index, site] of sites.entries()) {
      assertArrivalCompetition(
        costs.map((playerCosts) => playerCosts[index]!),
        biome,
      );
      assert.ok(bases.every((base) => manhattanDistance(base, site) >= 5));
    }
  }
  for (const pile of resources.filter((resource) => resource.hotspotId)) {
    assert.ok(bases.every((base) => manhattanDistance(base, pile) >= 4));
  }
}

function assertArrivalCompetition(costs: number[], biome: Biome): void {
  const arrivals = [...costs].sort((first, second) => first - second);
  const maximumLeadRatio = biome === "forest" ? 0.5 : 0.25;
  const maximumLead = Math.max(3, arrivals[1]! * maximumLeadRatio);
  assert.ok(arrivals[1]! - arrivals[0]! <= maximumLead, "Site must allow a rival to contest");
}

export function assertCompetitionSites(generated: GeneratedMap, biome: Biome): void {
  const { map, bases, resources, outposts, hotspots } = generated;
  assert.equal(hotspots.length, 6);
  assert.equal(outposts.length, 6);
  assert.equal(
    new Set([...bases, ...outposts, ...hotspots].map(positionKey)).size,
    bases.length + 12,
  );
  for (const outpost of outposts) {
    assert.equal(map.tiles[outpost.y]![outpost.x], BIOMES[biome].spawnTerrain);
    assert.equal(outpost.ownerId, null);
    assert.ok(!resources.some((pile) => positionKey(pile) === positionKey(outpost)));
  }
  for (const hotspot of hotspots) assertHotspotStock(generated, hotspot);
}

function assertHotspotStock(generated: GeneratedMap, hotspot: Hotspot): void {
  const stock = generated.resources.filter((pile) => pile.hotspotId === hotspot.id);
  assert.ok(stock.length > 0 && stock.length <= 5);
  for (const pile of stock) {
    assert.ok(pile.kind === "relic" || pile.kind === "crystal");
    assert.ok(pile.amount >= 2 && pile.amount <= 3);
    assert.ok(manhattanDistance(pile, hotspot) <= hotspot.radius);
  }
}

interface BiomeSample {
  biome: Biome;
  generated: GeneratedMap;
}

export function assertHotspotVariety(samples: BiomeSample[]): void {
  for (const biome of BIOME_IDS) {
    const matching = samples.filter((sample) => sample.biome === biome);
    const positions = matching.map(({ generated }) =>
      generated.hotspots.map(positionKey).join(";"),
    );
    assert.ok(new Set(positions).size >= 6, `${biome}: layouts should vary across seeds`);
  }
  for (const { generated } of samples) assertValidHotspots(generated);

  assert.ok(
    samples.some(({ generated }) =>
      generated.hotspots.some((site) => {
        const outsideColumns =
          Math.abs(site.x - (generated.map.width - 1) / 2) > generated.map.width * 0.25;
        const outsideRows =
          Math.abs(site.y - (generated.map.height - 1) / 2) > generated.map.height * 0.25;

        return outsideColumns || outsideRows;
      }),
    ),
    "Hotspots can use outer terrain when access permits",
  );
}

function assertValidHotspots(generated: GeneratedMap): void {
  for (const site of generated.hotspots) {
    assert.ok(Number.isFinite(terrainCost(generated.map, site)));
    assert.ok(!generated.bases.some((base) => positionKey(base) === positionKey(site)));
  }
}

export function placeScenarioSites(scenario: ReturnType<typeof createOpenSiteScenario>) {
  return placeCompetitionSites(scenario.setup, scenario.starts);
}
