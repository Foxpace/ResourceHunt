import {
  distanceField,
  getInventoryStats,
  canGrab,
  positionKey,
  RESOURCES,
  terrainCost,
  type Action,
  type Observation,
} from "../src/sdk.ts";

export function forage(
  state: Observation,
  strategy: "nearest" | "value" | "courier" | "wander",
  random = Math.random,
): Action {
  const { self, map, capacity } = state;
  const load = getInventoryStats(state).weight;
  const routes = distanceField(map, self.position);
  const home = routes.get(positionKey(self.base));
  if (
    load &&
    (load >= capacity - 1 ||
      state.remainingTicks <= (home?.cost ?? 0) + 3 ||
      (strategy === "courier" && load >= capacity / 2))
  )
    return { type: "home" };
  if (canGrab(state)) return { type: "grab" };
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
    if (!best || score > best.score) best = { score, direction: route.steps[0]! };
  }
  return best
    ? { type: "move", direction: best.direction }
    : load
      ? { type: "home" }
      : { type: "skip" };
}
