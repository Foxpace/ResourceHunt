import {
  DIRECTIONS,
  findPath,
  inventoryWeight,
  inventoryValue,
  samePosition,
  searchRoutesFrom,
  terrainCost,
  travelCostsTo,
  type OriginRoutes,
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
import {
  getBankingSites,
  getNearestBank,
  type BankingRoute,
  type BankingSite,
} from "./competition.ts";

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

interface TripContext {
  state: Observation;
  units: number;
  inventory: InventoryStats;
  sites: BankingSite[];
}

interface TripRoutes {
  outbound: Route | null;
  returnRoute: BankingRoute | null;
}

interface TripBank {
  site: BankingSite;
  cost: number;
}

interface TripCandidate {
  pile: ResourcePile;
  bank: TripBank;
}

interface OpponentSearch {
  state: Observation;
  position: Position;
  selfOrder: number;
}

interface OpponentTravel {
  bot: BotState;
  cost: number;
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

export interface OpponentArrivalTicks {
  botId: string;
  arrivalTick: number;
  readyTick: number;
  turnOrder: number;
}

export interface OpponentArrivalTime extends OpponentArrivalTicks {
  route: Route | null;
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
  return planTripTo(createTripContext(state, units), pile);
}

/** Pick the feasible trip with the most resource value per turn, in candidate order on ties. */
export function findBestTrip(
  state: Observation,
  candidates: readonly ResourcePile[],
  units = 1,
): TripPlan | null {
  const context = createTripContext(state, units);
  if (state.self.disabled) return null;
  if (candidates.length === 1) {
    const plan = planTripTo(context, candidates[0]!);
    return plan.feasible ? plan : null;
  }

  return planBestCandidateTrip(context, candidates);
}

function planBestCandidateTrip(
  context: TripContext,
  candidates: readonly ResourcePile[],
): TripPlan | null {
  const { state, units } = context;
  const piles = candidates.filter((pile) => (findTripResource(state, pile)?.amount ?? 0) >= units);
  if (!piles.length) return null;
  const outbound = searchRoutesFrom(state.map, state.self.position);
  if (!outbound) return null;

  const best = chooseTrip(context, piles, outbound);
  if (!best) return null;

  const homeward = findPath(state.map, best.pile, best.bank.site);
  if (!homeward) return null;

  return createTripPlan(context, best.pile, {
    outbound: outbound.routeTo(best.pile),
    returnRoute: { site: best.bank.site, route: homeward },
  });
}

function planTripTo(context: TripContext, pile: ResourcePile): TripPlan {
  const { state } = context;
  return createTripPlan(context, pile, {
    outbound: findPath(state.map, state.self.position, pile),
    returnRoute: getNearestBank(state, pile),
  });
}

function createTripContext(state: Observation, units: number): TripContext {
  const invalidUnitCount = !Number.isSafeInteger(units) || units < 1;
  if (invalidUnitCount) throw new RangeError("units must be a positive safe integer");

  return { state, units, inventory: getInventoryStats(state), sites: getBankingSites(state) };
}

function createTripPlan(context: TripContext, pile: ResourcePile, routes: TripRoutes): TripPlan {
  const { state, units, inventory } = context;
  const { outbound, returnRoute } = routes;
  const homeward = returnRoute?.route ?? null;
  const bank = returnRoute ? { site: returnRoute.site, cost: returnRoute.route.cost } : null;
  const returnTurns = getReturnTurns(state, pile, bank);
  const travelTurns = state.self.travelRemaining + (outbound?.cost ?? Infinity) + returnTurns;
  const totalTurns = travelTurns + units;
  const resourceValue = units * RESOURCES[pile.kind].value;
  const reasons = getTripFailureReasons(context, pile, { outbound, homeward, totalTurns });

  return {
    units,
    outbound,
    homeward,
    bank: returnRoute?.site ?? null,
    travelTurns,
    totalTurns,
    resourceValue,
    bankedValue: inventory.carriedValue + resourceValue,
    grabTurns: units,
    reasons,
    feasible: reasons.length === 0,
  };
}

function getReturnTurns(state: Observation, pile: ResourcePile, bank: TripBank | null): number {
  if (!bank) return Infinity;
  if (samePosition(pile, bank.site)) return bank.cost;

  // Depositing happens on arrival, before the final tile's travel delay.
  return bank.cost - (terrainCost(state.map, bank.site) - 1);
}

function chooseTrip(
  context: TripContext,
  piles: ResourcePile[],
  outbound: OriginRoutes,
): TripCandidate | undefined {
  const banks = findTripBanks(context, piles);
  let best: TripCandidate | undefined;
  let bestRate = -Infinity;

  for (const [index, pile] of piles.entries()) {
    const bank = banks[index];
    if (!bank) continue;

    const rate = getTripRate(context, { pile, bank }, outbound);
    if (rate <= bestRate) continue;

    best = { pile, bank };
    bestRate = rate;
  }

  return best;
}

function findTripBanks(context: TripContext, piles: ResourcePile[]): (TripBank | undefined)[] {
  const banks: (TripBank | undefined)[] = [];
  for (const site of context.sites) {
    const costs = travelCostsTo(context.state.map, site, piles);
    for (const [index, cost] of costs.entries()) {
      const previousCost = banks[index]?.cost ?? Infinity;
      banks[index] = cost < previousCost ? { site, cost } : banks[index];
    }
  }

  return banks;
}

function getTripRate(
  context: TripContext,
  candidate: TripCandidate,
  outbound: OriginRoutes,
): number {
  const { state, units } = context;
  const { pile, bank } = candidate;
  const cost = outbound.costTo(pile);
  if (!Number.isFinite(cost)) return -Infinity;

  const returnTurns = getReturnTurns(state, pile, bank);
  const totalTurns = state.self.travelRemaining + cost + returnTurns + units;
  if (totalTurns > state.remainingTicks) return -Infinity;
  if (!canCarryTrip(context, pile, () => outbound.routeTo(pile))) return -Infinity;

  return (units * RESOURCES[pile.kind].value) / totalTurns;
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
): OpponentArrivalTime[];
export function getOpponentArrivalTimes(
  state: Observation,
  position: Position,
  options: { routes: false },
): OpponentArrivalTicks[];
export function getOpponentArrivalTimes(
  state: Observation,
  position: Position,
  options?: { routes: false },
): OpponentArrivalTicks[] {
  const count = state.bots.length;
  const selfIndex = state.bots.findIndex((bot) => bot.id === state.self.id);
  if (selfIndex < 0) throw new Error("Observation self must appear in bots");

  const selfOrder = getTurnOrder(selfIndex, state.tick, count);
  const search = { state, position, selfOrder };
  const timingOnly = options?.routes === false;
  const arrivals = timingOnly ? estimateOpponentTicks(search) : estimateOpponentRoutes(search);

  return arrivals.sort(
    (first, second) => first.readyTick - second.readyTick || first.turnOrder - second.turnOrder,
  );
}

function estimateOpponentRoutes(search: OpponentSearch): OpponentArrivalTime[] {
  const { state, position } = search;
  return state.bots.flatMap((bot, index) => {
    if (bot.id === state.self.id) return [];

    const route = findPath(state.map, bot.position, position);
    const timing = calculateOpponentTiming(search, { bot, index, cost: route?.cost ?? Infinity });
    return [{ botId: bot.id, route, ...timing }];
  });
}

function estimateOpponentTicks(search: OpponentSearch): OpponentArrivalTicks[] {
  const { state, position } = search;
  const opponents = state.bots.flatMap((bot, index) => {
    const eligible = bot.id !== state.self.id;
    return eligible ? [{ bot, index }] : [];
  });
  const origins = opponents.map(({ bot }) => (bot.disabled ? position : bot.position));
  const costs = travelCostsTo(state.map, position, origins);

  return opponents.map(({ bot, index }, offset) => ({
    botId: bot.id,
    ...calculateOpponentTiming(search, { bot, index, cost: costs[offset]! }),
  }));
}

function getTurnOrder(index: number, tick: number, count: number): number {
  return (index - (tick % count) + count) % count;
}

function canCarryTrip(context: TripContext, pile: ResourcePile, outbound: () => Route | null) {
  const { state, sites, units, inventory } = context;
  const itemWeight = RESOURCES[pile.kind].weight;
  const atHome = sites.some((site) => samePosition(pile, site));
  // At home each grab is banked immediately, so only one unit must fit at a time.
  if (atHome) return itemWeight <= state.capacity;

  const pickupWeight = units * itemWeight;
  if (pickupWeight > state.capacity) return false;
  if (pickupWeight + inventory.weight <= state.capacity) return true;

  const route = outbound();
  return !!route && sites.some((site) => routePassesBank(state.self.position, route, site));
}

function findTripResource(state: Observation, pile: ResourcePile): ResourcePile | undefined {
  return state.resources.find((current) => {
    const sharesTile = samePosition(current, pile);
    const matchesKind = current.kind === pile.kind;
    return sharesTile && matchesKind;
  });
}

function getTripFailureReasons(
  context: TripContext,
  pile: ResourcePile,
  trip: Pick<TripPlan, "outbound" | "homeward" | "totalTurns">,
): TripFailure[] {
  const { state, units } = context;
  const currentPile = findTripResource(state, pile);
  const { outbound, homeward, totalTurns } = trip;
  const reasons: TripFailure[] = [];
  if (state.self.disabled) reasons.push("disabled");
  if (!currentPile) reasons.push("missing-resource");
  else if (currentPile.amount < units) reasons.push("insufficient-resources");
  if (!canCarryTrip(context, pile, () => outbound)) reasons.push("capacity");

  const routeMissing = !outbound || !homeward;
  if (routeMissing) reasons.push("unreachable");
  if (totalTurns > state.remainingTicks) reasons.push("deadline");

  return reasons;
}

function calculateOpponentTiming(search: OpponentSearch, travel: OpponentTravel) {
  const { state } = search;
  const count = state.bots.length;
  const { arrivalTick, readyTick } = calculateOpponentTravelTicks(search, travel);
  const turnOrder = Number.isFinite(readyTick)
    ? getTurnOrder(travel.index, readyTick, count)
    : Infinity;

  return { arrivalTick, readyTick, turnOrder };
}

function calculateOpponentTravelTicks(search: OpponentSearch, opponent: OpponentTravel) {
  const { state, position, selfOrder } = search;
  const { bot, cost, index } = opponent;

  const opponentCanTravel = Number.isFinite(cost) && !bot.disabled;
  if (!opponentCanTravel) return { arrivalTick: Infinity, readyTick: Infinity };

  const alreadyActed = getTurnOrder(index, state.tick, state.bots.length) < selfOrder;
  const nextTurn = state.tick + Number(alreadyActed) + bot.travelRemaining;
  const atTarget = samePosition(bot.position, position);
  const arrivalTick = atTarget ? state.tick : nextTurn + cost - terrainCost(state.map, position);

  return { arrivalTick, readyTick: nextTurn + cost };
}
