import type { MapSetup, ResourceLayout } from "./maps/generation-models.ts";
import { mapCells } from "./grid.ts";
import { placeBases } from "./map-layout.ts";
import { nearStart } from "./maps/starting-areas.ts";
import { randomFromSeed } from "./random.ts";
import { positionKey, samePosition, terrainCost } from "./pathfinding.ts";
import { balanceOpeningResources } from "./maps/opening-resources.ts";
import { generateBiome } from "./maps/biome-generator.ts";
import { placeCompetitionSites, stockHotspots } from "./maps/competition-map.ts";
import {
  type GameConfig,
  type GameMap,
  type Position,
  type ResourceKind,
  type ResourcePile,
  type Hotspot,
  type Outpost,
} from "./types.ts";

export function generateMap(
  config: GameConfig,
  botCount: number,
): {
  map: GameMap;
  bases: Position[];
  resources: ResourcePile[];
  hotspots: Hotspot[];
  outposts: Outpost[];
} {
  const proposedBases = placeBases(config, botCount);
  const random = randomFromSeed(`${config.seed}:map`);
  const { map, bases, openingCells } = generateBiome(config, proposedBases, random);
  const protectedCells = [...bases, ...openingCells];
  const setup = { map, config };
  const starts = { bases, protectedCells };
  const { hotspots, outposts } = placeCompetitionSites(setup, starts);
  const layout = { ...starts, hotspots, outposts };

  const resources = scatterResources(setup, layout, random);
  if (config.resourceDensity > 0) stockOpeningCells(resources, openingCells);

  stockHotspots(setup, layout, resources);
  balanceOpeningResources(setup, layout, resources);

  return { map, bases, resources, hotspots, outposts };
}

function scatterResources(
  setup: MapSetup,
  layout: ResourceLayout,
  random: () => number,
): ResourcePile[] {
  const { map, config } = setup;
  const { bases, hotspots, outposts } = layout;
  const resources: ResourcePile[] = [];

  for (const { x, y } of mapCells(map)) {
    const position = { x, y };

    const terrainSuitable =
      Number.isFinite(terrainCost(map, position)) && map.tiles[y]![x] !== "bridge";
    const positionReserved =
      nearStart(position, bases) || outposts.some((post) => samePosition(post, position));
    if (!terrainSuitable || positionReserved) continue;

    const shouldPlaceResource = random() < config.resourceDensity;
    if (!shouldPlaceResource) continue;

    resources.push(createScatteredResource(position, hotspots.length, random));
  }

  return resources;
}

function stockOpeningCells(resources: ResourcePile[], openingCells: Position[]): void {
  for (const position of openingCells) {
    const existing = resources.findIndex((pile) => positionKey(pile) === positionKey(position));
    if (existing >= 0) resources.splice(existing, 1);

    resources.push({ ...position, kind: "crystal", amount: 2 });
  }
}

function createScatteredResource(
  position: Position,
  hotspotCount: number,
  random: () => number,
): ResourcePile {
  const kindRoll = random();
  const kind: ResourceKind =
    kindRoll < (hotspotCount ? 0.78 : 0.56)
      ? "ore"
      : kindRoll < (hotspotCount ? 0.97 : 0.88)
        ? "crystal"
        : "relic";
  return { ...position, kind, amount: 1 + Math.floor(random() * 3) };
}
