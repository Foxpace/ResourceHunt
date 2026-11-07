import {
  canGrab,
  findNearestRoute,
  findPath,
  getInventoryStats,
  RESOURCES,
  type Action,
  type Bot,
  type Observation,
  type InventoryStats,
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
    const bag = getInventoryStats(state);
    if (shouldBank(state, bag)) return { type: "home" };
    if (canGrab(state)) return { type: "grab" };

    const targets = state.resources.filter((pile) => RESOURCES[pile.kind].weight <= bag.freeWeight);
    const nearest = findNearestRoute(state.map, state.self.position, targets);
    const direction = nearest?.route.steps[0];
    if (direction) return { type: "move", direction };

    return bag.weight > 0 ? { type: "home" } : { type: "skip" };
  }
}

function shouldBank(state: Observation, bag: InventoryStats): boolean {
  if (!bag.weight) return false;
  if (!bag.freeWeight) return true;

  const homeCost = findPath(state.map, state.self.position, state.self.base)?.cost ?? 0;
  return state.remainingTicks <= homeCost + HOME_MARGIN;
}
