import {
  canGrab,
  distanceField,
  getInventoryStats,
  positionKey,
  RESOURCES,
  type Action,
  type Bot,
  type Observation,
  type Route,
} from "../src/sdk.ts";

const HOME_MARGIN = 2;

/** Deliberately simple baseline: no stealing, defense, outposts, or risk planning. */
export default class Nearest implements Bot {
  static metadata = {
    id: "nearest",
    name: "Scout",
    description: "Walks to the closest resource that fits, grabs it, and banks when full or late.",
  };

  act(state: Observation): Action {
    const routes = distanceField(state.map, state.self.position);
    if (shouldBank(state, routes)) return { type: "home" };
    if (canGrab(state)) return { type: "grab" };

    const direction = closestResourceRoute(state, routes)?.steps[0];
    if (direction) return { type: "move", direction };

    return getInventoryStats(state).weight > 0 ? { type: "home" } : { type: "skip" };
  }
}

function shouldBank(state: Observation, routes: Map<string, Route>): boolean {
  const bag = getInventoryStats(state);
  const homeCost = routes.get(positionKey(state.self.base))?.cost ?? 0;
  const bagFull = bag.freeWeight === 0;
  const timeShort = state.remainingTicks <= homeCost + HOME_MARGIN;

  return bag.weight > 0 && (bagFull || timeShort);
}

function closestResourceRoute(state: Observation, routes: Map<string, Route>) {
  const freeWeight = getInventoryStats(state).freeWeight;
  let closest: Route | undefined;

  for (const pile of state.resources) {
    const route = routes.get(positionKey(pile));
    const fits = RESOURCES[pile.kind].weight <= freeWeight;
    const closer = route !== undefined && (!closest || route.cost < closest.cost);
    if (fits && closer) closest = route;
  }

  return closest;
}
