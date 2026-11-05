import { isOutpostProtected } from "../competition.ts";
import { manhattanDistance } from "../grid.ts";
import type { BotState, Outpost } from "../types.ts";
import { countWorldAction, isGuarded, recordWorldAction } from "./shared.ts";
import type { WorldCommand, WorldTurn } from "./types.ts";

const SABOTAGE_DOWNTIME = 6;
const SABOTAGE_COOLDOWN = 12;

export function sabotageDepot(turn: WorldTurn, command: WorldCommand): void {
  const { bot, action } = command;
  if (!("targetId" in action)) return;

  const outpost = turn.context.outposts.find((site) => site.id === action.targetId);
  const eligible = !!outpost && canSabotageDepot(turn, bot, outpost);
  if (!eligible) {
    bot.lastAction = "Depot sabotage unavailable";
    return;
  }

  outpost.disabledUntilTick = turn.context.tick + SABOTAGE_DOWNTIME;
  outpost.sabotageProtectedUntilTick = turn.context.tick + SABOTAGE_COOLDOWN;
  bot.lastAction = `Sabotaged ${outpost.id} · banking offline for ${SABOTAGE_DOWNTIME} ticks`;
  countWorldAction(turn, bot.id, "sabotages");
  recordWorldAction(turn, bot, "sabotage");
}

export function canSabotageDepot(turn: WorldTurn, bot: BotState, outpost: Outpost): boolean {
  if (!turn.context.config.sabotage) return false;
  if (isOutpostProtected(outpost, turn.context.tick)) return false;

  const ownerGuarding = turn.context.bots.some((owner) => {
    const ownsDepot = owner.id === outpost.ownerId;
    const withinDefenseRange = manhattanDistance(owner.position, outpost) <= 1;
    const guardIsActive = isGuarded(turn, owner.id);

    return ownsDepot && withinDefenseRange && guardIsActive;
  });
  const hasOwner = !!outpost.ownerId;
  const belongsToRival = outpost.ownerId !== bot.id;
  const enemyOwned = hasOwner && belongsToRival;
  const withinSabotageRange = manhattanDistance(bot.position, outpost) <= 1;
  const bankingOperational = (outpost.disabledUntilTick ?? 0) <= turn.context.tick;
  const protectionExpired = (outpost.sabotageProtectedUntilTick ?? 0) <= turn.context.tick;
  const depotAccessible = withinSabotageRange && bankingOperational && protectionExpired;

  return enemyOwned && depotAccessible && !ownerGuarding;
}

export function repairDepot(turn: WorldTurn, command: WorldCommand): void {
  const { bot, action } = command;
  if (!("targetId" in action)) return;

  const outpost = turn.context.outposts.find((site) => site.id === action.targetId);
  const owned = !!outpost && outpost.ownerId === bot.id;
  const nearby = !!outpost && manhattanDistance(bot.position, outpost) <= 1;
  const disabled = (outpost?.disabledUntilTick ?? 0) > turn.context.tick;
  if (!owned || !nearby || !disabled) {
    bot.lastAction = "No damaged owned depot within repair range";
    return;
  }
  outpost.disabledUntilTick = 0;
  bot.lastAction = `Repaired ${outpost.id}`;
  countWorldAction(turn, bot.id, "repairs");
  recordWorldAction(turn, bot, "guard");
}
