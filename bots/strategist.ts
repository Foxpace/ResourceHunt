import {
  canCapture,
  canGrab,
  distanceField,
  getInventoryStats,
  getNearestBank,
  getStealTargets,
  planTrip,
  positionKey,
  RESOURCES,
  samePosition,
  type Action,
  type Bot,
  type Observation,
} from "../src/sdk.ts";

/** Claims a forward bank, then competes for valuable cargo and nearby deposits. */
export default class Strategist implements Bot {
  static metadata = {
    id: "strategist",
    name: "Strategist",
    description: "Claims outposts, targets valuable trips, and steals exposed cargo.",
  };

  act(state: Observation): Action {
    const bag = getInventoryStats(state);
    const bank = getNearestBank(state);
    if (bag.weight && state.remainingTicks <= (bank?.route.cost ?? Infinity) + 2)
      return { type: "home" };
    const theft = getStealTargets(state)[0];
    const here = state.resources.find((pile) => samePosition(pile, state.self.position));
    if (theft && (!canGrab(state) || theft.value > RESOURCES[here!.kind].value))
      return { type: "steal", targetId: theft.botId };

    const routes = distanceField(state.map, state.self.position);
    if (
      !state.outposts.some((post) => post.ownerId === state.self.id) &&
      state.tick < state.maxTicks * 0.5
    ) {
      const posts = state.outposts
        .filter(
          (post) =>
            !state.bots.some(
              (bot) =>
                bot.id !== state.self.id && !bot.disabled && samePosition(bot.position, post),
            ),
        )
        .map((post) => ({ post, route: routes.get(positionKey(post)) }))
        .filter(
          (item) =>
            item.route && item.route.cost + state.config.captureTurns + 4 < state.remainingTicks,
        )
        .sort((a, b) => a.route!.cost - b.route!.cost);
      const target = posts[0];
      if (target) {
        if (samePosition(state.self.position, target.post) && canCapture(state))
          return { type: "capture" };
        const direction = target.route!.steps[0];
        if (direction) return { type: "move", direction };
      }
    }
    if (canGrab(state)) return { type: "grab" };

    const candidates = state.resources
      .filter((pile) => RESOURCES[pile.kind].weight <= bag.freeWeight)
      .map((pile) => ({ pile, cost: routes.get(positionKey(pile))?.cost ?? Infinity }))
      .filter((item) => Number.isFinite(item.cost))
      .sort(
        (a, b) =>
          RESOURCES[b.pile.kind].value / (b.cost + 1) - RESOURCES[a.pile.kind].value / (a.cost + 1),
      )
      .slice(0, 12);
    let best: { action: Action; efficiency: number } | undefined;
    for (const { pile } of candidates) {
      const units = Math.min(pile.amount, Math.floor(bag.freeWeight / RESOURCES[pile.kind].weight));
      const plan = planTrip(state, pile, units);
      const direction = plan.outbound?.steps[0];
      const efficiency = plan.resourceValue / plan.totalTurns;
      if (plan.feasible && direction && (!best || efficiency > best.efficiency))
        best = { action: { type: "move", direction }, efficiency };
    }
    return best?.action ?? { type: bag.weight ? "home" : "skip" };
  }
}
