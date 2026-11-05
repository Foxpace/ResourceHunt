import { manhattanDistance } from "../grid.ts";
import { inventoryWeight, samePosition } from "../pathfinding.ts";
import { RESOURCES, type Position } from "../types.ts";
import { releaseDroneCargo } from "./scavenger-drones.ts";
import { countWorldAction, recordWorldAction } from "./shared.ts";
import {
  guardianPosition,
  type GuardianCache,
  type WorldCommand,
  type WorldTurn,
} from "./types.ts";

export function strikeNeutralEnemy(turn: WorldTurn, command: WorldCommand): void {
  const { bot, action } = command;
  if (!("targetId" in action)) return;

  const drone = turn.state.drones.find((enemy) => enemy.id === action.targetId);
  const cache = turn.state.caches.find((site) => site.id === action.targetId);
  const target = drone?.position ?? (cache ? guardianPosition(cache) : undefined);
  const nearby = !!target && manhattanDistance(bot.position, target) <= 1;
  if (!nearby) {
    bot.lastAction = "No enemy within strike range";
    return;
  }
  if (drone?.health) {
    drone.health--;
    countWorldAction(turn, bot.id, "droneStrikes");
    if (!drone.health) releaseDroneCargo(turn, drone);
  } else if (cache?.guardianHealth) {
    cache.guardianHealth--;
    countWorldAction(turn, bot.id, "guardianStrikes");
    if (!cache.guardianHealth) countWorldAction(turn, bot.id, "guardiansDefeated");
  } else {
    bot.lastAction = "Enemy already disabled";
    return;
  }

  bot.lastAction = `Struck ${action.targetId}`;
  recordWorldAction(turn, bot, "strike");
}

export function lootGuardianCache(turn: WorldTurn, command: WorldCommand): void {
  const { bot, action } = command;
  if (!("targetId" in action)) return;

  const cache = turn.state.caches.find((site) => site.id === action.targetId);
  const accessible = cache ? isStandingOnUnguardedCache(bot.position, cache) : false;
  const kind = cache?.inventory[0];
  const fits =
    !!kind &&
    inventoryWeight(bot.inventory) + RESOURCES[kind].weight <= turn.context.config.capacity;
  if (!accessible || !fits || !kind) {
    bot.lastAction = "Cache is guarded, empty, distant, or cargo cannot fit";
    return;
  }

  cache.inventory.shift();
  countWorldAction(turn, bot.id, "cacheLooted");
  bot.inventory.push(kind);
  bot.lastAction = `Looted ${kind} from ${cache.id}`;
  recordWorldAction(turn, bot, "loot");
}

function isStandingOnUnguardedCache(position: Position, cache: GuardianCache): boolean {
  const guardianDefeated = cache.guardianHealth === 0;
  const standingOnCache = samePosition(position, cache.position);

  return guardianDefeated && standingOnCache;
}
