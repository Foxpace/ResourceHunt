import { getBankingSites, type BankingSite } from "./depot-rules.ts";
import { manhattanDistance } from "./grid.ts";
import { findNearestRoute, inventoryWeight, samePosition, type Route } from "./pathfinding.ts";
import {
  RESOURCES,
  type BotState,
  type Observation,
  type Position,
  type ResourceKind,
} from "./types.ts";

export {
  canCapture,
  getBankingSites,
  isBankingTile,
  isContested,
  isOutpostProtected,
} from "./depot-rules.ts";
export type { BankingSite } from "./depot-rules.ts";

export interface BankingRoute {
  site: BankingSite;
  route: Route;
}
export interface StealTarget {
  botId: string;
  kind: ResourceKind;
  value: number;
  weight: number;
}

export function getNearestBank(
  state: Pick<Observation, "self" | "outposts" | "map"> & { tick?: number },
  from: Position = state.self.position,
): BankingRoute | null {
  const best = findNearestRoute(state.map, from, getBankingSites(state));
  return best ? { site: best.target, route: best.route } : null;
}

/** Shared theft eligibility for the engine and SDK. Highest-value fitting cargo wins. */
export function stealableItem(
  context: Pick<Observation, "config" | "tick" | "bots">,
  thief: BotState,
  victim: BotState,
): ResourceKind | null {
  const { config, tick, bots } = context;

  const theftEnabled = config.stealing && thief.id !== victim.id;
  const thiefTravelling = thief.travelRemaining > 0;

  const thiefActive = !thief.disabled;
  const cooldownExpired = tick >= thief.stealReadyTick;
  const thiefReady = thiefActive && !thiefTravelling && cooldownExpired;
  const victimExposed =
    tick >= victim.theftProtectedUntilTick &&
    manhattanDistance(thief.position, victim.position) <= 1;
  if (!theftEnabled || !thiefReady || !victimExposed) return null;
  if (bots.some(({ base }) => samePosition(base, thief.position))) return null;
  if (bots.some(({ base }) => samePosition(base, victim.position))) return null;

  const freeWeight = config.capacity - inventoryWeight(thief.inventory);
  return highestValueFittingItem(victim.inventory, freeWeight);
}

function highestValueFittingItem(
  inventory: ResourceKind[],
  freeWeight: number,
): ResourceKind | null {
  let best: ResourceKind | null = null;

  for (const kind of inventory) {
    const itemFits = RESOURCES[kind].weight <= freeWeight;
    const moreValuable = !best || RESOURCES[kind].value > RESOURCES[best].value;
    const betterFittingItemFound = itemFits && moreValuable;
    if (betterFittingItemFound) best = kind;
  }

  return best;
}

export function getStealTargets(state: Observation): StealTarget[] {
  if (state.remainingTicks <= 0) return [];

  const theftContext = { ...state, config: { ...state.config, capacity: state.capacity } };

  return state.bots
    .flatMap((victim) => {
      const kind = stealableItem(theftContext, state.self, victim);

      return kind
        ? [{ botId: victim.id, kind, value: RESOURCES[kind].value, weight: RESOURCES[kind].weight }]
        : [];
    })
    .sort((first, second) => second.value - first.value);
}

export function canSteal(state: Observation, targetId: string): boolean {
  return getStealTargets(state).some((target) => target.botId === targetId);
}
