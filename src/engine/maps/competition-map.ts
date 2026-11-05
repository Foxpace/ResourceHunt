import { StrategicSitePlanner } from "./strategic-site-planner.ts";
import type { MapSetup, StartingLayout, ResourceLayout } from "./generation-models.ts";
import { manhattanDistance, cellsInRectangle } from "../grid.ts";
import { positionKey, samePosition, terrainCost } from "../pathfinding.ts";
import { BIOMES } from "../biomes.ts";
import { randomFromSeed } from "../random.ts";
import type { GameMap, Hotspot, Outpost, Position, ResourcePile } from "../types.ts";

/** Shared sites balance access from the actual bases rather than fixed map coordinates. */
export function placeCompetitionSites(setup: MapSetup, starts: StartingLayout) {
  const { map, config } = setup;
  const hotspotCount = config.resourceDensity > 0 ? config.hotspotCount : 0;
  const sitesDisabled = config.outpostCount === 0 && hotspotCount === 0;
  if (sitesDisabled) return { hotspots: [], outposts: [] };

  const planner = new StrategicSitePlanner(setup, starts);
  const outposts = createOutposts(setup, planner.placeOutposts(config.outpostCount));
  if (outposts.length) planner.refreshTravelTimes(map, starts.bases);

  const hotspots = planner.placeHotspots(hotspotCount).map((position, index) => ({
    ...position,
    id: `hotspot-${index + 1}`,
    radius: 2,
  }));

  return { hotspots, outposts };
}

function createOutposts(setup: MapSetup, positions: Position[]): Outpost[] {
  const { map, config } = setup;

  return positions.map((position, index) => {
    map.tiles[position.y]![position.x] = BIOMES[config.biome].spawnTerrain;

    return {
      ...position,
      id: `outpost-${index + 1}`,
      ownerId: null,
      capturingBotId: null,
      captureProgress: 0,
    };
  });
}

/** Hotspots have finite, high-value supplies; normal opening resources stay untouched. */
export function stockHotspots(
  setup: MapSetup,
  layout: ResourceLayout,
  resources: ResourcePile[],
): void {
  const { map, config } = setup;
  const { hotspots, outposts, protectedCells } = layout;
  const random = randomFromSeed(`${config.seed}:hotspot-stock`);
  const reserved = new Set([...protectedCells, ...outposts].map(positionKey));
  const context: HotspotStockContext = {
    map,
    hotspots,
    resources,
    random,
    reserved,
    used: new Set(),
  };

  for (const hotspot of hotspots) {
    const candidates = stockCandidates(context, hotspot);
    stockHotspotResources(context, hotspot, candidates);
  }
}

interface HotspotStockContext {
  map: GameMap;
  hotspots: Hotspot[];
  resources: ResourcePile[];
  random: () => number;
  reserved: Set<string>;
  used: Set<string>;
}

type StockCandidate = Position & { distance: number; tie: number };

function stockCandidates(context: HotspotStockContext, hotspot: Hotspot): StockCandidate[] {
  const { map, hotspots, reserved, used, random } = context;
  const candidates: StockCandidate[] = [];
  const cells = hotspotCells(map, hotspot);

  for (const { x, y } of cells) {
    const distance = manhattanDistance({ x, y }, hotspot);
    const withinHotspot = distance <= hotspot.radius;

    const terrainSuitable =
      Number.isFinite(terrainCost(map, { x, y })) && map.tiles[y]![x] !== "bridge";
    const positionReserved = reserved.has(`${x},${y}`) || used.has(`${x},${y}`);
    if (!withinHotspot || !terrainSuitable || positionReserved) continue;
    const occupiesOtherHotspot = hotspots.some((other) => {
      const isOtherHotspot = other.id !== hotspot.id;
      const sharesColumn = other.x === x;
      const sharesRow = other.y === y;
      return isOtherHotspot && sharesColumn && sharesRow;
    });
    if (occupiesOtherHotspot) continue;

    candidates.push({ x, y, distance, tie: random() });
  }

  return candidates;
}

function stockHotspotResources(
  context: HotspotStockContext,
  hotspot: Hotspot,
  candidates: StockCandidate[],
): void {
  const { resources, used, random } = context;

  candidates.sort((first, second) => first.distance - second.distance || first.tie - second.tie);

  for (const [index, p] of candidates.slice(0, 5).entries()) {
    const existing = resources.findIndex((pile) => samePosition(pile, p));
    if (existing >= 0) resources.splice(existing, 1);

    used.add(positionKey(p));
    resources.push({
      x: p.x,
      y: p.y,
      kind: index % 2 === 0 ? "relic" : "crystal",
      amount: 2 + Math.floor(random() * 2),
      hotspotId: hotspot.id,
    });
  }
}

function hotspotCells(map: GameMap, hotspot: Hotspot): Generator<Position> {
  return cellsInRectangle({
    left: Math.max(0, hotspot.x - hotspot.radius),
    top: Math.max(0, hotspot.y - hotspot.radius),
    right: Math.min(map.width - 1, hotspot.x + hotspot.radius),
    bottom: Math.min(map.height - 1, hotspot.y + hotspot.radius),
  });
}
