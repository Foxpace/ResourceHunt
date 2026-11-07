import { manhattanDistance } from "./grid.ts";
import { samePosition } from "./pathfinding.ts";
import type { BotState, Observation, Outpost, Position } from "./types.ts";

export interface BankingSite extends Position {
  id: string;
  kind: "base" | "outpost";
}

export type DepotCaptureBlock =
  | { status: "protected"; untilTick: number }
  | { status: "missing" | "owned" | "contested" };

type DepotCapture = { status: "available"; outpost: Outpost } | DepotCaptureBlock;

export function getBankingSites(
  state: Pick<Observation, "self" | "outposts"> & { tick?: number },
): BankingSite[] {
  const { self, outposts } = state;
  const tick = state.tick ?? 0;
  return [
    { ...self.base, id: `base:${self.id}`, kind: "base" },
    ...outposts
      .filter((post) => canBankAtDepot(post, self.id, tick))
      .map((post) => ({ x: post.x, y: post.y, id: post.id, kind: "outpost" as const })),
  ];
}

export function isBankingTile(bot: BotState, outposts: Outpost[], tick = 0): boolean {
  if (samePosition(bot.position, bot.base)) return true;

  return outposts.some((post) => {
    const sharesBotTile = samePosition(post, bot.position);
    const available = canBankAtDepot(post, bot.id, tick);
    return sharesBotTile && available;
  });
}

function canBankAtDepot(post: Outpost, botId: string, tick: number): boolean {
  return post.ownerId === botId && !isDepotOffline(post, tick);
}

export function isDepotOffline(post: Outpost, tick: number): boolean {
  return (post.disabledUntilTick ?? 0) > tick;
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

export function checkDepotCapture({
  self,
  outposts,
  bots,
  tick,
}: Pick<Observation, "self" | "outposts" | "bots" | "tick">): DepotCapture {
  const outpost = outposts.find((post) => samePosition(post, self.position));
  if (!outpost) return { status: "missing" };
  if (outpost.ownerId === self.id) return { status: "owned" };
  if (isOutpostProtected(outpost, tick))
    return { status: "protected", untilTick: outpost.captureProtectedUntilTick ?? 0 };
  if (isContested(outpost, bots, self.id)) return { status: "contested" };

  return { status: "available", outpost };
}

export function canCapture(state: Observation): boolean {
  const botActive = !state.self.disabled;
  const travelFinished = state.self.travelRemaining === 0;
  const turnsRemaining = state.remainingTicks > 0;
  const botReady = botActive && travelFinished && turnsRemaining;

  return botReady && checkDepotCapture(state).status === "available";
}

export function canRepairDepot(
  outpost: Outpost | undefined,
  bot: BotState,
  tick: number,
): outpost is Outpost {
  if (!outpost) return false;

  const owned = outpost.ownerId === bot.id;
  const nearby = manhattanDistance(bot.position, outpost) <= 1;
  const offline = isDepotOffline(outpost, tick);
  return owned && nearby && offline;
}
