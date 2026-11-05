import {
  DIRECTIONS,
  findPath,
  inventoryWeight,
  inventoryValue,
  samePosition,
  terrainCost,
  type Route,
} from "./pathfinding.ts";
import {
  RESOURCES,
  type BotState,
  type Direction,
  type Observation,
  type Position,
  type ResourcePile,
  type Terrain,
} from "./types.ts";
import { getBankingSites, getNearestBank, type BankingSite } from "./competition.ts";

export interface MoveOption {
  direction: Direction;
  destination: Position;
  terrain: Terrain | null;
  cost: number;
  passable: boolean;
}

export interface InventoryStats {
  units: number;
  weight: number;
  capacity: number;
  freeWeight: number;
  carriedValue: number;
}

interface ResourceTrip {
  pile: ResourcePile;
  units: number;
}

interface OpponentSearch {
  state: Observation;
  position: Position;
  selfOrder: number;
}

interface OpponentRoute {
  bot: BotState;
  route: Route | null;
  index: number;
}

export type TripFailure =
  | "disabled"
  | "missing-resource"
  | "insufficient-resources"
  | "capacity"
  | "unreachable"
  | "deadline";

export interface TripPlan {
  units: number;
  outbound: Route | null;
  homeward: Route | null;
  bank: BankingSite | null;
  travelTurns: number;
  grabTurns: number;
  totalTurns: number;
  resourceValue: number;
  bankedValue: number;
  feasible: boolean;
  reasons: TripFailure[];
}

export interface OpponentArrivalTime {
  botId: string;
  route: Route | null;
  arrivalTick: number;
  readyTick: number;
  turnOrder: number;
}

/** All four neighbors, including blocked and out-of-bounds destinations. */
export function getMoveOptions(state: Observation): MoveOption[] {
  return (Object.entries(DIRECTIONS) as [Direction, Position][]).map(([direction, delta]) => {
    const destination = {
      x: state.self.position.x + delta.x,
      y: state.self.position.y + delta.y,
    };
    const cost = terrainCost(state.map, destination);

    return {
      direction,
      destination,
      terrain: state.map.tiles[destination.y]?.[destination.x] ?? null,
      cost,
      passable: Number.isFinite(cost),
    };
  });
}

export function getInventoryStats(state: Observation): InventoryStats {
  const { inventory } = state.self;
  const weight = inventoryWeight(inventory);

  return {
    units: inventory.length,
    weight,
    capacity: state.capacity,
    freeWeight: state.capacity - weight,
    carriedValue: inventoryValue(inventory),
  };
}

/** Whether grab would collect one unit from the current tile on this turn. */
export function canGrab(state: Observation): boolean {
  const isDisabled = state.self.disabled;
  const isTravelling = state.self.travelRemaining > 0;
  const noTurnsRemaining = state.remainingTicks <= 0;
  const cannotAct = isDisabled || isTravelling || noTurnsRemaining;
  if (cannotAct) {
    return false;
  }

  const pile = state.resources.find((pile) => samePosition(pile, state.self.position));

  if (!pile) return false;

  const hasResources = pile.amount > 0;
  const itemFits = RESOURCES[pile.kind].weight <= getInventoryStats(state).freeWeight;

  return hasResources && itemFits;
}

/** Follow the returned outbound route, grab the requested units, then follow homeward. */
export function planTrip(state: Observation, pile: ResourcePile, units = 1): TripPlan {
  const invalidUnitCount = !Number.isSafeInteger(units) || units < 1;
  if (invalidUnitCount) {
    throw new RangeError("units must be a positive safe integer");
  }

  const trip = { pile, units };
  const details = calculateTrip(state, trip);
  const reasons = getTripFailureReasons(state, trip, details);

  return { units, ...details, grabTurns: units, reasons, feasible: reasons.length === 0 };
}

function calculateTrip(state: Observation, trip: ResourceTrip) {
  const { pile, units } = trip;

  const outbound = findPath(state.map, state.self.position, pile);
  const bank = getNearestBank(state, pile);
  const homeward = bank?.route ?? null;
  const stats = getInventoryStats(state);
  const resource = RESOURCES[pile.kind];
  // Depositing happens on arrival; the final home tile's extra travel delay is not owed first.
  const returnTurns = homeward
    ? homeward.cost - (homeward.steps.length ? terrainCost(state.map, bank!.site) - 1 : 0)
    : Infinity;
  const travelTurns = state.self.travelRemaining + (outbound?.cost ?? Infinity) + returnTurns;
  const totalTurns = travelTurns + units;

  return {
    outbound,
    homeward,
    bank: bank?.site ?? null,
    travelTurns,
    totalTurns,
    resourceValue: units * resource.value,
    bankedValue: stats.carriedValue + units * resource.value,
  };
}

function routePassesBank(from: Position, route: Route, bankPosition: Position): boolean {
  const position = { ...from };

  for (const direction of route.steps) {
    const delta = DIRECTIONS[direction];
    position.x += delta.x;
    position.y += delta.y;
    if (samePosition(position, bankPosition)) return true;
  }

  return false;
}

/** Earliest arrival and next decision at a target, assuming direct, cheapest travel. */
export function getOpponentArrivalTimes(
  state: Observation,
  position: Position,
): OpponentArrivalTime[] {
  const count = state.bots.length;
  const selfIndex = state.bots.findIndex((bot) => bot.id === state.self.id);
  if (selfIndex < 0) throw new Error("Observation self must appear in bots");

  const selfOrder = getTurnOrder(selfIndex, state.tick, count);

  return state.bots
    .flatMap((bot, index) => estimateOpponentArrival({ state, position, selfOrder }, bot, index))
    .sort(
      (first, second) => first.readyTick - second.readyTick || first.turnOrder - second.turnOrder,
    );
}

function getTurnOrder(index: number, tick: number, count: number): number {
  return (index - (tick % count) + count) % count;
}

function calculateTripRequiredWeight(
  state: Observation,
  request: ResourceTrip,
  outbound: Route | null,
): number {
  const { pile, units } = request;
  const startingLoad = getInventoryStats(state).weight;

  const sites = getBankingSites(state);
  const atHome = sites.some((site) => samePosition(pile, site));

  const unloadsOnWay =
    outbound && sites.some((site) => routePassesBank(state.self.position, outbound, site));
  const startingWeight = unloadsOnWay ? 0 : startingLoad;

  // At home each grab is banked immediately, so only one unit must fit at a time.
  return atHome
    ? RESOURCES[pile.kind].weight
    : startingWeight + units * RESOURCES[pile.kind].weight;
}

function getTripFailureReasons(
  state: Observation,
  request: ResourceTrip,
  trip: ReturnType<typeof calculateTrip>,
): TripFailure[] {
  const { pile, units } = request;

  const currentPile = state.resources.find((current) => {
    const sharesTile = samePosition(current, pile);
    const matchesKind = current.kind === pile.kind;
    return sharesTile && matchesKind;
  });
  const requiredWeight = calculateTripRequiredWeight(state, request, trip.outbound);
  const { outbound, homeward, totalTurns } = trip;
  const reasons: TripFailure[] = [];
  if (state.self.disabled) reasons.push("disabled");
  if (!currentPile) reasons.push("missing-resource");
  else if (currentPile.amount < units) reasons.push("insufficient-resources");
  if (requiredWeight > state.capacity) reasons.push("capacity");

  const routeMissing = !outbound || !homeward;
  if (routeMissing) reasons.push("unreachable");
  if (totalTurns > state.remainingTicks) reasons.push("deadline");

  return reasons;
}

function estimateOpponentArrival(
  search: OpponentSearch,
  bot: BotState,
  index: number,
): OpponentArrivalTime[] {
  const { state, position } = search;
  const count = state.bots.length;
  if (bot.id === state.self.id) return [];

  const route = findPath(state.map, bot.position, position);
  const { arrivalTick, readyTick } = calculateOpponentTravelTicks(search, { bot, route, index });

  return [
    {
      botId: bot.id,
      route,
      arrivalTick,
      readyTick,
      turnOrder: Number.isFinite(readyTick) ? getTurnOrder(index, readyTick, count) : Infinity,
    },
  ];
}

function calculateOpponentTravelTicks(search: OpponentSearch, opponent: OpponentRoute) {
  const { state, position, selfOrder } = search;
  const { bot, route, index } = opponent;

  const opponentCanTravel = !!route && !bot.disabled;
  if (!opponentCanTravel) return { arrivalTick: Infinity, readyTick: Infinity };

  const alreadyActed = getTurnOrder(index, state.tick, state.bots.length) < selfOrder;
  const nextTurn = state.tick + Number(alreadyActed) + bot.travelRemaining;
  const arrivalTick = route.steps.length
    ? nextTurn + route.cost - terrainCost(state.map, position)
    : state.tick;

  return { arrivalTick, readyTick: nextTurn + route.cost };
}
