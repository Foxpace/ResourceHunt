import type { MatchStatistics } from "../match-statistics.ts";
import { manhattanDistance } from "../grid.ts";
import { samePosition } from "../pathfinding.ts";
import type { BotState, Position, ResourceKind } from "../types.ts";
import type { VisualEffect, WorldTurn } from "./types.ts";

export function countWorldAction(turn: WorldTurn, botId: string, key: keyof MatchStatistics) {
  const stats = turn.context.statistics?.get(botId);
  if (stats) stats[key]++;
}

export function isGuarded(turn: WorldTurn, botId: string): boolean {
  return turn.state.defenses.some((defense) => {
    const matchesBot = defense.botId === botId;
    const guardIsActive = defense.guardedUntilTick > turn.context.tick;

    return matchesBot && guardIsActive;
  });
}

export function isSafeBase(turn: WorldTurn, position: Position): boolean {
  return turn.context.bots.some((bot) => manhattanDistance(bot.base, position) <= 3);
}

export function recordWorldEvent(
  turn: WorldTurn,
  event: { message: string; position: Position; effect: VisualEffect; botId?: string },
): void {
  turn.context.events.push({
    tick: turn.context.tick + 1,
    kind: "world",
    botId: event.botId ?? "world",
    ...event,
  });
}

export function recordWorldAction(turn: WorldTurn, bot: BotState, effect: VisualEffect): void {
  recordWorldEvent(turn, {
    botId: bot.id,
    message: bot.lastAction,
    position: bot.position,
    effect,
  });
}

export function dropResource(turn: WorldTurn, position: Position, kind: ResourceKind): void {
  const pile = turn.context.resources.find((resource) => {
    const matchesPosition = samePosition(resource, position);
    const matchesKind = resource.kind === kind;

    return matchesPosition && matchesKind;
  });
  if (pile) pile.amount++;
  else turn.context.resources.push({ ...position, kind, amount: 1 });
}

export function spillCargo(turn: WorldTurn, bot: BotState): boolean {
  if (isGuarded(turn, bot.id)) return false;

  const kind = bot.inventory.pop();
  if (!kind) return false;

  bot.lost++;
  dropResource(turn, bot.position, kind);

  return true;
}

export function interruptBot(turn: WorldTurn, bot: BotState): void {
  if (isGuarded(turn, bot.id)) return;

  spillCargo(turn, bot);
  bot.travelRemaining = Math.max(bot.travelRemaining, 1);
}

export function isExposedBot(turn: WorldTurn, bot: BotState): boolean {
  const isActive = !bot.disabled;
  const insideSafeArea = isSafeBase(turn, bot.position);
  const cargoIsGuarded = isGuarded(turn, bot.id);

  return isActive && !insideSafeArea && !cargoIsGuarded;
}
