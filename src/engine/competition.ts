import { manhattanDistance } from "./grid.ts";
import { findPath, inventoryWeight, samePosition, type Route } from "./pathfinding.ts";
import {
  RESOURCES,
  type BotState,
  type Observation,
  type Outpost,
  type Position,
  type ResourceKind,
} from "./types.ts";

export interface BankingSite extends Position {
  id: string;
  kind: "base" | "outpost";
}
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

export function getBankingSites(
  state: Pick<Observation, "self" | "outposts"> & { tick?: number },
): BankingSite[] {
  return [
    { ...state.self.base, id: `base:${state.self.id}`, kind: "base" },
    ...state.outposts
      .filter((post) => {
        const isOwned = post.ownerId === state.self.id;
        const bankingEnabled = (post.disabledUntilTick ?? 0) <= (state.tick ?? 0);
        return isOwned && bankingEnabled;
      })
      .map((post) => ({ x: post.x, y: post.y, id: post.id, kind: "outpost" as const })),
  ];
}

export function getNearestBank(
  state: Pick<Observation, "self" | "outposts" | "map"> & { tick?: number },
  from: Position = state.self.position,
): BankingRoute | null {
  let best: BankingRoute | null = null;

  for (const site of getBankingSites(state)) {
    const route = findPath(state.map, from, site);
    if (!route) continue;

    const closerBankFound = !best || route.cost < best.route.cost;
    if (closerBankFound) best = { site, route };
  }

  return best;
}

export function isBankingTile(bot: BotState, outposts: Outpost[], tick = 0): boolean {
  const atBase = samePosition(bot.position, bot.base);
  const atOperationalDepot = outposts.some((post) => {
    const isOwned = post.ownerId === bot.id;
    const sharesBotTile = samePosition(post, bot.position);
    const bankingEnabled = (post.disabledUntilTick ?? 0) <= tick;

    return isOwned && sharesBotTile && bankingEnabled;
  });

  return atBase || atOperationalDepot;
}

export function isContested(post: Position, bots: BotState[], actorId: string): boolean {
  return bots.some((other) => {
    const isRival = other.id !== actorId;
    const isActive = !other.disabled;
    const occupiesDepot = samePosition(other.position, post);
    return isRival && isActive && occupiesDepot;
  });
}

export function isOutpostProtected(outpost: Outpost, tick: number): boolean {
  const hasOwner = outpost.ownerId !== null;
  const immunityActive = (outpost.captureProtectedUntilTick ?? 0) > tick;

  return hasOwner && immunityActive;
}

export function canCapture(state: Observation): boolean {
  const post = state.outposts.find((post) => samePosition(post, state.self.position));

  if (!post) return false;

  const belongsToRival = post.ownerId !== state.self.id;
  const captureProtected = isOutpostProtected(post, state.tick);
  const depotContested = isContested(post, state.bots, state.self.id);
  const depotAvailable = belongsToRival && !captureProtected && !depotContested;

  const botActive = !state.self.disabled;
  const travelFinished = state.self.travelRemaining === 0;
  const turnsRemaining = state.remainingTicks > 0;
  const botReady = botActive && travelFinished && turnsRemaining;

  return depotAvailable && botReady;
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
