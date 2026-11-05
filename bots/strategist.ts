import {
  canCapture,
  getDefensiveAction,
  protectDroneCrossing,
  getCompetitiveAction,
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
  type Route,
  type Outpost,
  type ResourcePile,
} from "../src/sdk.ts";

/** Claims a forward bank, then competes for valuable cargo and nearby deposits. */
export default class Strategist implements Bot {
  static metadata = {
    id: "strategist",
    name: "Strategist",
    description: "Claims outposts, targets valuable trips, and steals exposed cargo.",
  };

  act(state: Observation): Action {
    return protectDroneCrossing(state, this.chooseAction(state));
  }

  private chooseAction(state: Observation): Action {
    const defense = getDefensiveAction(state);
    if (defense) return defense;

    const bag = getInventoryStats(state);
    const bank = getNearestBank(state);
    const hasCargo = bag.weight > 0;
    const bankingDeadlineNear = state.remainingTicks <= (bank?.route.cost ?? Infinity) + 2;
    const mustBankBeforeDeadline = hasCargo && bankingDeadlineNear;
    if (mustBankBeforeDeadline) return { type: "home" };

    const competition = getCompetitiveAction(state);
    if (competition) return competition;

    return this.chooseCollectionAction(state);
  }

  private chooseCollectionAction(state: Observation): Action {
    const theftAction = this.chooseTheftAction(state);
    if (theftAction) return theftAction;

    const routes = distanceField(state.map, state.self.position);
    const outpostAction = this.chooseOutpostAction(state, routes);
    if (outpostAction) return outpostAction;
    if (canGrab(state)) return { type: "grab" };

    return this.chooseResourceAction(state, routes);
  }

  private chooseTheftAction(state: Observation): Action | undefined {
    const theft = getStealTargets(state)[0];
    if (!theft) return;
    if (canGrab(state)) {
      const pile = state.resources.find((pile) => samePosition(pile, state.self.position))!;
      const collectionIsMoreValuable = theft.value <= RESOURCES[pile.kind].value;
      if (collectionIsMoreValuable) return;
    }

    return { type: "steal", targetId: theft.botId };
  }

  private chooseResourceAction(state: Observation, routes: Map<string, Route>): Action {
    const bag = getInventoryStats(state);
    const candidates = state.resources
      .filter((pile) => RESOURCES[pile.kind].weight <= bag.freeWeight)
      .map((pile) => ({ pile, cost: routes.get(positionKey(pile))?.cost ?? Infinity }))
      .filter((item) => Number.isFinite(item.cost))
      .sort(
        (first, second) =>
          RESOURCES[second.pile.kind].value / (second.cost + 1) -
          RESOURCES[first.pile.kind].value / (first.cost + 1),
      )
      .slice(0, 12);
    let best: { action: Action; efficiency: number } | undefined;

    for (const { pile } of candidates) {
      const candidate = this.planCollectionTrip(state, pile);
      if (!candidate) continue;

      const improvesEfficiency = !best || candidate.efficiency > best.efficiency;
      if (improvesEfficiency) best = candidate;
    }

    return best?.action ?? { type: bag.weight ? "home" : "skip" };
  }

  private planCollectionTrip(state: Observation, pile: ResourcePile) {
    const freeWeight = getInventoryStats(state).freeWeight;
    const units = Math.min(pile.amount, Math.floor(freeWeight / RESOURCES[pile.kind].weight));
    const plan = planTrip(state, pile, units);
    if (!plan.feasible) return;

    const direction = plan.outbound?.steps[0];
    if (!direction) return;

    const action: Action = { type: "move", direction };
    const efficiency = plan.resourceValue / plan.totalTurns;

    return { action, efficiency };
  }

  private chooseOutpostAction(state: Observation, routes: Map<string, Route>): Action | undefined {
    const ownsForwardBank = state.outposts.some((post) => post.ownerId === state.self.id);
    const expansionDeadlinePassed = state.tick >= state.maxTicks * 0.5;
    const skipOutpostExpansion = ownsForwardBank || expansionDeadlinePassed;
    if (skipOutpostExpansion) return;

    const posts = state.outposts
      .filter(
        (post) =>
          !state.bots.some((bot) => {
            const isRival = bot.id !== state.self.id;
            const isActive = !bot.disabled;
            const occupiesDepot = samePosition(bot.position, post);
            return isRival && isActive && occupiesDepot;
          }),
      )
      .map((post) => ({ post, route: routes.get(positionKey(post)) }))
      .filter((item) => {
        if (!item.route) return false;
        const captureAndTravelTurns = item.route.cost + state.config.captureTurns + 4;
        return captureAndTravelTurns < state.remainingTicks;
      })
      .sort((first, second) => first.route!.cost - second.route!.cost);
    const target = posts[0];
    if (!target) return;

    return this.approachOutpost(state, target.post, target.route!);
  }

  private approachOutpost(state: Observation, outpost: Outpost, route: Route): Action | undefined {
    const standingOnDepot = samePosition(state.self.position, outpost);
    const captureAvailable = canCapture(state);
    const readyToCapture = standingOnDepot && captureAvailable;
    if (readyToCapture) return { type: "capture" };

    const direction = route.steps[0];
    if (direction) return { type: "move", direction };
  }
}
