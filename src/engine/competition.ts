import { findPath, inventoryWeight, samePosition, type Route } from "./pathfinding.ts";
import {
  RESOURCES,
  type BotState,
  type GameConfig,
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

export function getBankingSites(state: Pick<Observation, "self" | "outposts">): BankingSite[] {
  return [
    { ...state.self.base, id: `base:${state.self.id}`, kind: "base" },
    ...state.outposts
      .filter((post) => post.ownerId === state.self.id)
      .map((post) => ({ x: post.x, y: post.y, id: post.id, kind: "outpost" as const })),
  ];
}

export function getNearestBank(
  state: Pick<Observation, "self" | "outposts" | "map">,
  from: Position = state.self.position,
): BankingRoute | null {
  let best: BankingRoute | null = null;
  for (const site of getBankingSites(state)) {
    const route = findPath(state.map, from, site);
    if (route && (!best || route.cost < best.route.cost)) best = { site, route };
  }
  return best;
}

export function isBankingTile(bot: BotState, outposts: Outpost[]): boolean {
  return (
    samePosition(bot.position, bot.base) ||
    outposts.some((post) => post.ownerId === bot.id && samePosition(post, bot.position))
  );
}

export function isContested(post: Position, bots: BotState[], actorId: string): boolean {
  return bots.some(
    (other) => other.id !== actorId && !other.disabled && samePosition(other.position, post),
  );
}

export function canCapture(state: Observation): boolean {
  const post = state.outposts.find((post) => samePosition(post, state.self.position));
  return (
    !!post &&
    post.ownerId !== state.self.id &&
    !state.self.disabled &&
    state.self.travelRemaining === 0 &&
    state.remainingTicks > 0 &&
    !isContested(post, state.bots, state.self.id)
  );
}

/** Shared theft eligibility for the engine and SDK. Highest-value fitting cargo wins. */
export function stealableItem(
  config: GameConfig,
  tick: number,
  bots: BotState[],
  thief: BotState,
  victim: BotState,
): ResourceKind | null {
  if (
    !config.stealing ||
    thief.id === victim.id ||
    thief.disabled ||
    thief.travelRemaining > 0 ||
    tick < thief.stealReadyTick ||
    tick < victim.theftProtectedUntilTick ||
    !samePosition(thief.position, victim.position)
  )
    return null;
  if (bots.some((bot) => samePosition(bot.base, thief.position))) return null;
  const free = config.capacity - inventoryWeight(thief.inventory);
  let best: ResourceKind | null = null;
  for (const kind of victim.inventory) {
    if (RESOURCES[kind].weight <= free && (!best || RESOURCES[kind].value > RESOURCES[best].value))
      best = kind;
  }
  return best;
}

export function getStealTargets(state: Observation): StealTarget[] {
  if (state.remainingTicks <= 0) return [];
  return state.bots
    .flatMap((victim) => {
      const kind = stealableItem(
        { ...state.config, capacity: state.capacity },
        state.tick,
        state.bots,
        state.self,
        victim,
      );
      return kind
        ? [{ botId: victim.id, kind, value: RESOURCES[kind].value, weight: RESOURCES[kind].weight }]
        : [];
    })
    .sort((a, b) => b.value - a.value);
}

export function canSteal(state: Observation, targetId: string): boolean {
  return getStealTargets(state).some((target) => target.botId === targetId);
}
