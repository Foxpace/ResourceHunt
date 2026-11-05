import {
  canCapture,
  canLootCache,
  canRepair,
  canSabotage,
  getGuardianFightAction,
  DIRECTIONS,
  distanceField,
  getBankingSites,
  getDefensiveAction,
  protectDroneCrossing,
  getInventoryStats,
  getStealTargets,
  getTrapAction,
  positionKey,
  RESOURCES,
  samePosition,
  terrainCost,
  type Action,
  type Bot,
  type GuardianCache,
  type Observation,
  type Position,
  type Route,
} from "../src/sdk.ts";
import { manhattanDistance } from "../src/engine/grid.ts";

interface Opportunity {
  action: Action;
  rate: number;
}

interface Routes {
  outbound: Map<string, Route>;
  returnTurns(position: Position): number;
}

/** Uses quick raids to supplement bankable collection trips. */
export default class Raider implements Bot {
  static metadata = {
    id: "raider",
    name: "Raider",
    description:
      "Collects valuable cargo and looks for quick thefts, depot raids, and cache fights.",
  };

  act(state: Observation): Action {
    return protectDroneCrossing(state, this.chooseAction(state));
  }

  private chooseAction(state: Observation): Action {
    const defense = getDefensiveAction(state);
    if (defense) return defense;

    const routes = createRoutes(state);
    const bag = getInventoryStats(state);
    const bankIn = routes.returnTurns(state.self.position);
    const carriesCargo = bag.units > 0;
    const bagFull = bag.freeWeight === 0;
    const deadlineNear = state.remainingTicks <= bankIn + 2;
    const mustBank = carriesCargo && (bagFull || deadlineNear);
    if (mustBank) return { type: "home" };

    const repair = state.outposts.find((post) => canRepair(state, post.id));
    if (repair) return { type: "repair", targetId: repair.id };

    return chooseOpportunity(state, routes, bankIn);
  }
}

function chooseOpportunity(state: Observation, routes: Routes, bankIn: number): Action {
  const theft = getStealTargets(state)[0];
  const timeToBankTheft = state.remainingTicks > bankIn;
  if (theft && timeToBankTheft) return { type: "steal", targetId: theft.botId };
  const trap = getTrapAction(state);
  if (trap) return trap;

  const expansion = captureNearbyDepot(state, routes);
  if (expansion) return expansion;

  const collection = bestCollection(state, routes);
  const raid = bestRaid(state, routes);
  const best = chooseHigherRateOpportunity(collection, raid);
  return best?.action ?? { type: state.self.inventory.length ? "home" : "skip" };
}

function chooseHigherRateOpportunity(
  first?: Opportunity,
  second?: Opportunity,
): Opportunity | undefined {
  if (!first) return second;
  if (!second) return first;

  return second.rate > first.rate ? second : first;
}

function createRoutes(state: Observation): Routes {
  const banks = getBankingSites(state).map((site) => distanceField(state.map, site));
  return {
    outbound: distanceField(state.map, state.self.position),
    returnTurns(position) {
      const key = positionKey(position);
      const reversed = Math.min(...banks.map((field) => field.get(key)?.cost ?? Infinity));
      if (!Number.isFinite(reversed)) return Infinity;
      // The reversed path charges for entering the pickup tile. Deposits occur on arrival.
      return reversed === 0 ? 0 : reversed - terrainCost(state.map, position) + 1;
    },
  };
}

function bestCollection(state: Observation, routes: Routes): Opportunity | undefined {
  const free = getInventoryStats(state).freeWeight;
  let best: Opportunity | undefined;
  const seen = new Set<string>();
  for (const pile of state.resources) {
    const key = positionKey(pile);
    if (seen.has(key)) continue;
    // The engine grabs the first pile on a tile when spilled cargo overlaps a pile.
    seen.add(key);
    const route = routes.outbound.get(key);
    if (!route) continue;

    const resource = RESOURCES[pile.kind];
    const travel = route.cost + routes.returnTurns(pile);
    const units = Math.min(
      pile.amount,
      Math.floor(free / resource.weight),
      state.remainingTicks - travel,
    );
    if (units < 1) continue;

    const direction = route.steps[0];
    const action: Action = direction ? { type: "move", direction } : { type: "grab" };
    best = chooseHigherRateOpportunity(best, {
      action,
      rate: (units * resource.value) / (travel + units),
    });
  }
  return best;
}

function bestRaid(state: Observation, routes: Routes): Opportunity | undefined {
  let best = bestSabotage(state, routes);
  for (const cache of state.world.caches) {
    best = chooseHigherRateOpportunity(best, planCacheRaid(state, routes, cache));
  }
  return best;
}

function planCacheRaid(
  state: Observation,
  routes: Routes,
  cache: GuardianCache,
): Opportunity | undefined {
  const cargo = fittingCacheCargo(state, cache);
  if (!cargo.units) return;

  const guardian = cache.guardianPosition ?? cache.position;
  const guarded = cache.guardianHealth > 0;
  const route = guarded
    ? routeIntoRange(routes, guardian)
    : routes.outbound.get(positionKey(cache.position));
  if (!route) return;

  const fight = guarded
    ? cache.guardianHealth * 2 + manhattanDistance(cache.position, guardian)
    : 0;
  const turns = route.cost + fight + cargo.units + routes.returnTurns(cache.position);
  if (turns > state.remainingTicks) return;

  const direction = route.steps[0];
  const action = guarded
    ? approachGuardian(state, cache, direction)
    : canLootCache(state, cache.id)
      ? { type: "lootCache" as const, targetId: cache.id }
      : direction && { type: "move" as const, direction };

  return action ? { action, rate: (cargo.value * 1.1) / turns } : undefined;
}

function fittingCacheCargo(state: Observation, cache: GuardianCache) {
  let free = getInventoryStats(state).freeWeight;
  const cargo = { units: 0, value: 0 };
  for (const kind of cache.inventory) {
    const item = RESOURCES[kind];
    if (item.weight > free) break;
    free -= item.weight;
    cargo.units++;
    cargo.value += item.value;
  }
  return cargo;
}

function approachGuardian(
  state: Observation,
  cache: GuardianCache,
  direction: Route["steps"][number] | undefined,
): Action | undefined {
  const fight = getGuardianFightAction(state, cache.id);
  if (fight) return fight;
  if (!direction) return;

  const { position } = state.self;
  const delta = DIRECTIONS[direction];
  const destination = { x: position.x + delta.x, y: position.y + delta.y };
  const guardian = cache.guardianPosition ?? cache.position;
  const readyToAttack = cache.nextAttackTick <= state.tick;
  const withinTerritory = manhattanDistance(destination, cache.position) <= 3;
  const inDanger = withinTerritory && manhattanDistance(destination, guardian) <= 2;
  const protectedNow = state.world.defenses.some((defense) => {
    const ownsGuard = defense.botId === state.self.id;
    const isActive = defense.guardedUntilTick > state.tick;
    return ownsGuard && isActive;
  });

  return readyToAttack && inDanger && !protectedNow
    ? { type: "guard" }
    : { type: "move", direction };
}

function routeIntoRange(routes: Routes, target: Position): Route | undefined {
  const positions = [
    target,
    ...Object.values(DIRECTIONS).map(({ x, y }) => ({ x: x + target.x, y: y + target.y })),
  ];
  return positions
    .map((position) => routes.outbound.get(positionKey(position)))
    .sort((first, second) => (first?.cost ?? Infinity) - (second?.cost ?? Infinity))[0];
}

function bestSabotage(state: Observation, routes: Routes): Opportunity | undefined {
  const sabotageEnabled = state.config.sabotage;
  const timeToDisrupt = state.remainingTicks >= 8;
  if (!sabotageEnabled || !timeToDisrupt) return;

  let best: Opportunity | undefined;
  for (const post of state.outposts) {
    const owner = state.bots.find((bot) => bot.id === post.ownerId);
    const loaded = !!owner?.inventory.length;
    const active = owner && !owner.disabled;
    if (!loaded || !active) continue;

    const route = routeIntoRange(routes, post);
    const closeEnough = route && route.cost <= 3;
    if (!closeEnough) continue;

    const usingDepot = manhattanDistance(owner.position, post) <= 7;
    const farFromHome = manhattanDistance(owner.base, post) >= 5;
    if (!usingDepot || !farFromHome) continue;

    best = chooseHigherRateOpportunity(best, planSabotage(state, post, route));
  }
  return best;
}

function planSabotage(
  state: Observation,
  post: Observation["outposts"][number],
  route: Route,
): Opportunity | undefined {
  const ready = canSabotage(state, post.id);
  const direction = route.steps[0];
  const operational = (post.disabledUntilTick ?? 0) <= state.tick;
  const unprotected = (post.captureProtectedUntilTick ?? 0) <= state.tick;
  const toolCanReach = !!direction && operational;
  const vulnerable = unprotected && (post.sabotageProtectedUntilTick ?? 0) <= state.tick;
  const worthApproaching = toolCanReach && vulnerable;
  if (!ready && !worthApproaching) return;

  const action: Action = ready
    ? { type: "sabotage", targetId: post.id }
    : { type: "move", direction: direction! };
  const turns = route.cost + 1;
  return { action, rate: 8 / turns };
}

function captureNearbyDepot(state: Observation, routes: Routes): Action | undefined {
  const ownsDepot = state.outposts.some((post) => post.ownerId === state.self.id);
  const lateMatch = state.remainingTicks < 60;
  if (ownsDepot || lateMatch) return;

  for (const post of state.outposts) {
    const route = routes.outbound.get(positionKey(post));
    const rivalPresent = state.bots.some((bot) => {
      const rival = bot.id !== state.self.id && !bot.disabled;
      const atDepot = samePosition(bot.position, post);
      return rival && atDepot;
    });
    const neutral = post.ownerId === null;
    if (!neutral || rivalPresent || !route) continue;
    if (route.cost > 5) continue;

    const direction = route.steps[0];
    if (direction) return { type: "move", direction };
    if (canCapture(state)) return { type: "capture" };
  }
}
