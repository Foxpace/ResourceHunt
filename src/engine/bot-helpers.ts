import {
  DIRECTIONS,
  findPath,
  inventoryWeight,
  samePosition,
  terrainCost,
  type Route,
} from "./pathfinding.ts";
import {
  RESOURCES,
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
    carriedValue: inventory.reduce((sum, kind) => sum + RESOURCES[kind].value, 0),
  };
}

/** Whether grab would collect one unit from the current tile on this turn. */
export function canGrab(state: Observation): boolean {
  if (state.self.disabled || state.self.travelRemaining > 0 || state.remainingTicks <= 0) {
    return false;
  }
  const pile = state.resources.find((pile) => samePosition(pile, state.self.position));
  return (
    !!pile && pile.amount > 0 && RESOURCES[pile.kind].weight <= getInventoryStats(state).freeWeight
  );
}

/** Follow the returned outbound route, grab the requested units, then follow homeward. */
export function planTrip(state: Observation, pile: ResourcePile, units = 1): TripPlan {
  if (!Number.isSafeInteger(units) || units < 1) {
    throw new RangeError("units must be a positive safe integer");
  }
  const currentPile = state.resources.find(
    (current) => samePosition(current, pile) && current.kind === pile.kind,
  );
  const outbound = findPath(state.map, state.self.position, pile);
  const bank = getNearestBank(state, pile);
  const homeward = bank?.route ?? null;
  const stats = getInventoryStats(state);
  const resource = RESOURCES[pile.kind];
  const sites = getBankingSites(state);
  const atHome = sites.some((site) => samePosition(pile, site));
  const unloadsOnWay =
    outbound && sites.some((site) => passesHome(state.self.position, outbound, site));
  const startingWeight = unloadsOnWay ? 0 : stats.weight;
  // At home each grab is banked immediately, so only one unit must fit at a time.
  const requiredWeight = atHome ? resource.weight : startingWeight + units * resource.weight;
  // Depositing happens on arrival; the final home tile's extra travel delay is not owed first.
  const returnTurns = homeward
    ? homeward.cost - (homeward.steps.length ? terrainCost(state.map, bank!.site) - 1 : 0)
    : Infinity;
  const travelTurns = state.self.travelRemaining + (outbound?.cost ?? Infinity) + returnTurns;
  const totalTurns = travelTurns + units;
  const reasons: TripFailure[] = [];
  if (state.self.disabled) reasons.push("disabled");
  if (!currentPile) reasons.push("missing-resource");
  else if (currentPile.amount < units) reasons.push("insufficient-resources");
  if (requiredWeight > state.capacity) reasons.push("capacity");
  if (!outbound || !homeward) reasons.push("unreachable");
  if (totalTurns > state.remainingTicks) reasons.push("deadline");

  return {
    units,
    outbound,
    homeward,
    bank: bank?.site ?? null,
    travelTurns,
    grabTurns: units,
    totalTurns,
    resourceValue: units * resource.value,
    bankedValue: stats.carriedValue + units * resource.value,
    feasible: reasons.length === 0,
    reasons,
  };
}

function passesHome(from: Position, route: Route, home: Position): boolean {
  const position = { ...from };
  for (const direction of route.steps) {
    const delta = DIRECTIONS[direction];
    position.x += delta.x;
    position.y += delta.y;
    if (samePosition(position, home)) return true;
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
  const selfOrder = turnOrder(selfIndex, state.tick, count);

  return state.bots
    .flatMap((bot, index): OpponentArrivalTime[] => {
      if (bot.id === state.self.id) return [];
      const route = findPath(state.map, bot.position, position);
      let arrivalTick = Infinity;
      let readyTick = Infinity;
      if (route && !bot.disabled) {
        const alreadyActed = turnOrder(index, state.tick, count) < selfOrder;
        const nextTurn = state.tick + Number(alreadyActed) + bot.travelRemaining;
        // Entering the last tile updates position immediately; its cooldown precedes the next act.
        arrivalTick = route.steps.length
          ? nextTurn + route.cost - terrainCost(state.map, position)
          : state.tick;
        readyTick = nextTurn + route.cost;
      }
      return [
        {
          botId: bot.id,
          route,
          arrivalTick,
          readyTick,
          turnOrder: Number.isFinite(readyTick) ? turnOrder(index, readyTick, count) : Infinity,
        },
      ];
    })
    .sort((a, b) => a.readyTick - b.readyTick || a.turnOrder - b.turnOrder);
}

function turnOrder(index: number, tick: number, count: number): number {
  return (index - (tick % count) + count) % count;
}
