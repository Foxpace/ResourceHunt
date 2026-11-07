import { manhattanDistance, mapCells } from "../grid.ts";
import { cellIndex, positionKey, terrainCost, travelCostField } from "../pathfinding.ts";
import { RESOURCES, type GameMap, type Position, type ResourcePile } from "../types.ts";
import type { MapSetup, ResourceLayout } from "./generation-models.ts";
import { nearStart } from "./starting-areas.ts";

const OPENING_TRAVEL_LIMIT = 12;
const TRANSFER_BUDGET_PER_BASE = 2;

interface OpeningCell {
  position: Position;
  roundTrip: number;
}

interface OpeningPile {
  pile: ResourcePile;
  rate: number;
}

interface OpeningZone {
  cells: OpeningCell[];
  piles: OpeningPile[];
  rate: number;
}

interface OpeningSearch {
  map: GameMap;
  travel: Float64Array[];
  capacity: number;
}

interface ResourceTransfer {
  donor: OpeningZone;
  recipient: OpeningZone;
  source: OpeningPile;
  destination: OpeningCell;
  rate: number;
  improvement: number;
}

/** Share nearby scattered stock without changing terrain, opening piles, or strategic sites. */
export function balanceOpeningResources(
  setup: MapSetup,
  layout: ResourceLayout,
  resources: ResourcePile[],
): void {
  if (layout.bases.length < 2) return;
  if (!resources.length) return;

  const search = {
    map: setup.map,
    travel: layout.bases.map((base) => travelCostField(setup.map, base)),
    capacity: setup.config.capacity,
  };
  const zones = collectOpeningZones(search, layout, resources);
  for (let moved = 0; moved < TRANSFER_BUDGET_PER_BASE * zones.length; moved++) {
    const transfer = bestTransfer(zones, search.capacity);
    if (!transfer) break;

    movePile(transfer);
  }
}

function collectOpeningZones(
  search: OpeningSearch,
  layout: ResourceLayout,
  resources: ResourcePile[],
): OpeningZone[] {
  const zones: OpeningZone[] = search.travel.map(() => ({ cells: [], piles: [], rate: 0 }));
  const occupied = new Map(resources.map((pile) => [positionKey(pile), pile]));
  const outposts = new Set(layout.outposts.map(positionKey));

  for (const position of mapCells(search.map)) {
    const key = positionKey(position);
    if (outposts.has(key)) continue;
    if (!canBalanceCell(search.map, layout, position)) continue;

    const cell = cellIndex(search.map, position);
    const owner = closestBase(search.travel, cell);
    if (owner === undefined) continue;

    // Reversing the route exchanges the pile entry cost for the one-tick base entry cost.
    const roundTrip = 2 * search.travel[owner]![cell]! + 1 - terrainCost(search.map, position);
    const zone = zones[owner]!;
    const pile = occupied.get(key);
    if (pile) addOpeningPile(zone, pile, { roundTrip, capacity: search.capacity });
    else zone.cells.push({ position, roundTrip });
  }

  for (const zone of zones) zone.cells.sort((first, second) => first.roundTrip - second.roundTrip);
  return zones;
}

function canBalanceCell(map: GameMap, layout: ResourceLayout, position: Position): boolean {
  const bridge = map.tiles[position.y]![position.x] === "bridge";
  const startingArea = nearStart(position, layout.bases);
  const hotspotArea = layout.hotspots.some((hotspot) => {
    return manhattanDistance(position, hotspot) <= hotspot.radius;
  });

  return !bridge && !startingArea && !hotspotArea;
}

function closestBase(travel: Float64Array[], cell: number): number | undefined {
  let closest: number | undefined;
  let minimum = OPENING_TRAVEL_LIMIT + 1;
  for (const [index, field] of travel.entries()) {
    const cost = field[cell]!;
    if (cost === minimum) closest = undefined;
    if (cost >= minimum) continue;

    minimum = cost;
    closest = index;
  }
  return closest;
}

interface TripBudget {
  roundTrip: number;
  capacity: number;
}

function openingRate(pile: ResourcePile, budget: TripBudget): number {
  const { value, weight } = RESOURCES[pile.kind];
  const units = Math.min(pile.amount, Math.floor(budget.capacity / weight));
  return (units * value) / (budget.roundTrip + units);
}

function addOpeningPile(zone: OpeningZone, pile: ResourcePile, budget: TripBudget): void {
  const rate = openingRate(pile, budget);
  zone.rate += rate;
  zone.piles.push({ pile, rate });
}

function bestTransfer(zones: OpeningZone[], capacity: number): ResourceTransfer | undefined {
  let best: ResourceTransfer | undefined;
  for (const donor of zones) {
    for (const recipient of zones) {
      const transfer = transferBetween({ donor, recipient }, capacity);
      best = betterTransfer(best, transfer);
    }
  }
  return best;
}

function transferBetween(
  pair: Pick<ResourceTransfer, "donor" | "recipient">,
  capacity: number,
): ResourceTransfer | undefined {
  const { donor, recipient } = pair;
  const difference = donor.rate - recipient.rate;
  const destination = recipient.cells[0];
  if (difference <= 0) return;
  if (!destination) return;

  let best: ResourceTransfer | undefined;
  for (const source of donor.piles) {
    const rate = openingRate(source.pile, { roundTrip: destination.roundTrip, capacity });
    const improvement = difference - Math.abs(difference - source.rate - rate);
    if (improvement <= 0) continue;

    best = betterTransfer(best, { ...pair, source, destination, rate, improvement });
  }
  return best;
}

function betterTransfer(
  best: ResourceTransfer | undefined,
  transfer: ResourceTransfer | undefined,
): ResourceTransfer | undefined {
  if (!transfer) return best;
  const previous = best?.improvement ?? 0;
  return transfer.improvement > previous ? transfer : best;
}

function movePile(transfer: ResourceTransfer): void {
  const { donor, recipient, source, destination, rate } = transfer;
  Object.assign(source.pile, destination.position);
  donor.piles.splice(donor.piles.indexOf(source), 1);
  recipient.cells.shift();
  donor.rate -= source.rate;
  recipient.rate += rate;
}
