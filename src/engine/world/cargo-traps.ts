import { manhattanDistance } from "../grid.ts";
import { samePosition } from "../pathfinding.ts";
import {
  countWorldAction,
  isGuarded,
  isSafeBase,
  interruptBot,
  recordWorldAction,
} from "./shared.ts";
import type { WorldCommand, WorldTurn } from "./types.ts";
import type { BotState } from "../types.ts";

export function deployCargoTrap(turn: WorldTurn, bot: BotState): void {
  if (!canDeployCargoTrap(turn, bot)) {
    bot.lastAction = "Trap needs ore, a free tile outside bases, and a ready tool";
    return;
  }

  const { tick } = turn.context;
  const defense = turn.state.defenses.find((entry) => entry.botId === bot.id)!;
  const oreIndex = bot.inventory.indexOf("ore");
  bot.inventory.splice(oreIndex, 1);
  defense.toolsReadyTick = tick + 8;
  turn.state.traps.push({
    ...bot.position,
    id: `trap-${tick}-${turn.context.bots.indexOf(bot)}`,
    ownerId: bot.id,
    armedAt: tick + 1,
    expiresAt: tick + 30,
  });
  bot.lastAction = "Deployed cargo trap · arms next tick";
  countWorldAction(turn, bot.id, "trapsPlaced");
  recordWorldAction(turn, bot, "trap");
}

export function triggerCargoTrap(turn: WorldTurn, bot: BotState): void {
  const trap = turn.state.traps.find((site) => {
    const belongsToRival = site.ownerId !== bot.id;
    const isArmed = site.armedAt <= turn.context.tick;
    const sharesBotTile = samePosition(site, bot.position);

    return belongsToRival && isArmed && sharesBotTile;
  });
  const hasArmedRivalTrap = trap !== undefined;
  const botIsGuarding = isGuarded(turn, bot.id);
  const activeBotHasCargo = !bot.disabled && bot.inventory.length > 0;
  if (!hasArmedRivalTrap || botIsGuarding || !activeBotHasCargo) return;

  turn.state.traps = turn.state.traps.filter((site) => site !== trap);
  interruptBot(turn, bot);
  countWorldAction(turn, trap.ownerId, "trapsTriggered");
  countWorldAction(turn, bot.id, "trapsHit");
  bot.lastAction = "Cargo trap triggered · cargo spilled and movement delayed";
  recordWorldAction(turn, bot, "trap");
}

export function clearCargoTrap(turn: WorldTurn, command: WorldCommand): void {
  const { bot, action } = command;
  if (!("targetId" in action)) return;

  const trap = turn.state.traps.find((site) => site.id === action.targetId);
  const nearby = !!trap && manhattanDistance(trap, bot.position) <= 1;
  if (!nearby) {
    bot.lastAction = "No trap within clearing range";
    return;
  }

  turn.state.traps = turn.state.traps.filter((site) => site !== trap);
  countWorldAction(turn, bot.id, "trapsCleared");
  bot.lastAction = "Cleared cargo trap";
  recordWorldAction(turn, bot, "guard");
}

export function canDeployCargoTrap(turn: WorldTurn, bot: BotState): boolean {
  if (!turn.context.config.cargoTraps) return false;

  const defense = turn.state.defenses.find((entry) => entry.botId === bot.id);
  if (!defense) return false;

  const toolIsReady = defense.toolsReadyTick <= turn.context.tick;
  const hasOre = bot.inventory.includes("ore");
  const activeTrapCount = turn.state.traps.filter((trap) => trap.ownerId === bot.id).length;
  const belowTrapLimit = activeTrapCount < 2;
  const canConstructTrap = toolIsReady && hasOre && belowTrapLimit;
  const tileAvailable = isTrapLocationAvailable(turn, bot.position);

  return canConstructTrap && tileAvailable;
}

function isTrapLocationAvailable(turn: WorldTurn, position: BotState["position"]): boolean {
  const occupiedByTrap = turn.state.traps.some((trap) => samePosition(trap, position));
  const occupiedByDepot = turn.context.outposts.some((outpost) => samePosition(outpost, position));
  const tileOccupied = occupiedByTrap || occupiedByDepot;
  const insideSafeArea = isSafeBase(turn, position);
  const occupiedByCache = turn.state.caches.some((cache) => samePosition(cache.position, position));
  const protectedSite = insideSafeArea || occupiedByCache;

  return !tileOccupied && !protectedSite;
}
