import { placeBases } from "./map-layout.ts";
import { nearStart } from "./starting-areas.ts";
import { randomFromSeed } from "./random.ts";
import { positionKey, samePosition, terrainCost } from "./pathfinding.ts";
import { generateBiome } from "./biome-generator.ts";
import { placeCompetitionSites, stockHotspots } from "./competition-map.ts";
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
  const { width, height } = config;
  const { map, bases, openingCells } = generateBiome(config, proposedBases, random);
  const { tiles } = map;
  const protectedCells = [...bases, ...openingCells];
  const { hotspots, outposts } = placeCompetitionSites(map, config, protectedCells, bases);
  const resources: ResourcePile[] = [];
  const isBase = (p: Position) => bases.some((base) => samePosition(base, p));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (
        !Number.isFinite(terrainCost(map, { x, y })) ||
        tiles[y]![x] === "bridge" ||
        isBase({ x, y }) ||
        nearStart({ x, y }, bases) ||
        outposts.some((post) => samePosition(post, { x, y })) ||
        random() >= config.resourceDensity
      )
        continue;
      const kindRoll = random();
      const kind: ResourceKind =
        kindRoll < (hotspots.length ? 0.78 : 0.56)
          ? "ore"
          : kindRoll < (hotspots.length ? 0.97 : 0.88)
            ? "crystal"
            : "relic";
      resources.push({ x, y, kind, amount: 1 + Math.floor(random() * 3) });
    }
  // A small equal opening supply, except when resources were explicitly disabled.
  if (config.resourceDensity > 0)
    for (const p of openingCells) {
      const existing = resources.findIndex((pile) => positionKey(pile) === positionKey(p));
      if (existing >= 0) resources.splice(existing, 1);
      resources.push({ ...p, kind: "crystal", amount: 2 });
    }
  stockHotspots(map, config, hotspots, outposts, protectedCells, resources);
  return { map, bases, resources, hotspots, outposts };
}
