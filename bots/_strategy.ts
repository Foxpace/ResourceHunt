import {
  distanceField,
  getDefensiveAction,
  getCompetitiveAction,
  getStealTargets,
  samePosition,
  protectDroneCrossing,
  getInventoryStats,
  canGrab,
  positionKey,
  RESOURCES,
  terrainCost,
  type Action,
  type Route,
  type Observation,
} from "../src/sdk.ts";

type ForagingStrategy = "nearest" | "value" | "courier" | "wander";

interface ForagingContext {
  strategy: ForagingStrategy;
  random: () => number;
  routes: Map<string, Route>;
  load: number;
}

export function forage(
  state: Observation,
  strategy: ForagingStrategy,
  random = Math.random,
): Action {
  return protectDroneCrossing(state, chooseForageAction(state, strategy, random));
}

function chooseForageAction(
  state: Observation,
  strategy: ForagingStrategy,
  random: () => number,
): Action {
  const defense = getDefensiveAction(state);
  if (defense) return defense;

  const { self, map } = state;
  const load = getInventoryStats(state).weight;
  const routes = distanceField(map, self.position);
  const home = routes.get(positionKey(self.base));

  if (shouldBankCargo(state, strategy, home?.cost ?? 0)) return { type: "home" };
  const tactic = chooseLocalTactic(state, home?.cost ?? Infinity);
  if (tactic) return tactic;
  if (canGrab(state)) return { type: "grab" };

  const best = chooseResourceDirection(state, { strategy, random, routes, load });

  return best
    ? { type: "move", direction: best.direction }
    : load
      ? { type: "home" }
      : { type: "skip" };
}

function chooseLocalTactic(state: Observation, homeCost: number): Action | undefined {
  if (state.remainingTicks <= homeCost + 3) return;

  const theft = getStealTargets(state)[0];
  const pile = state.resources.find((resource) => samePosition(resource, state.self.position));
  const canCollectHere = canGrab(state);
  const localValue = pile && canCollectHere ? RESOURCES[pile.kind].value : 0;
  const stealIsWorthIt = theft && theft.value >= localValue;
  if (stealIsWorthIt) return { type: "steal", targetId: theft.botId };

  return getCompetitiveAction(state);
}

function shouldBankCargo(
  state: Observation,
  strategy: ForagingStrategy,
  homeCost: number,
): boolean {
  const carriedWeight = getInventoryStats(state).weight;
  const bagNearlyFull = carriedWeight >= state.capacity - 1;
  const courierStrategy = strategy === "courier";
  const bagAtLeastHalfFull = carriedWeight >= state.capacity / 2;
  const courierDeliveryDue = courierStrategy && bagAtLeastHalfFull;

  const bankingDeadlineNear = state.remainingTicks <= homeCost + 3;
  const bankingDue = bagNearlyFull || courierDeliveryDue || bankingDeadlineNear;
  const hasCargo = carriedWeight > 0;

  return hasCargo && bankingDue;
}

function chooseResourceDirection(state: Observation, context: ForagingContext) {
  const { strategy, random, routes, load } = context;
  const { self, map, capacity } = state;
  const fromHome = distanceField(map, self.base);
  let best: { score: number; direction: "N" | "W" | "E" | "S" } | undefined;

  for (const pile of state.resources) {
    if (RESOURCES[pile.kind].weight + load > capacity) continue;

    const route = routes.get(positionKey(pile));
    if (!route?.steps.length) continue;

    // Leave enough time to bank at least the first item from this trip.
    const returnCost =
      (fromHome.get(positionKey(pile))?.cost ?? Infinity) -
      terrainCost(map, pile) +
      terrainCost(map, self.base);
    if (route.cost + 1 + returnCost > state.remainingTicks) continue;

    const value =
      strategy === "value" ? RESOURCES[pile.kind].value / RESOURCES[pile.kind].weight : 1;
    const score = (value / (route.cost + 1)) * (strategy === "wander" ? 0.3 + random() : 1);

    const betterResourceFound = !best || score > best.score;
    if (betterResourceFound) best = { score, direction: route.steps[0]! };
  }

  return best;
}
