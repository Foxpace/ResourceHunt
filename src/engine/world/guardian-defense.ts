import { manhattanDistance } from "../grid.ts";
import { positionKey, samePosition } from "../pathfinding.ts";
import type { BotState, GameMap, Position } from "../types.ts";
import { getHazardMap } from "./hazard-map.ts";
import { nearestPosition, patrolStep, traversableNeighbors } from "./neutral-movement.ts";
import {
  countWorldAction,
  interruptBot,
  isExposedBot,
  isSafeBase,
  recordWorldEvent,
} from "./shared.ts";
import { guardianPosition, type GuardianCache, type WorldTurn } from "./types.ts";

const DEFENSE_RADIUS = 3;
const MIN_RETREAT_DISTANCE = 3;

interface GuardianTurn {
  world: WorldTurn;
  map: GameMap;
  cache: GuardianCache;
}

export function advanceCacheGuardians(world: WorldTurn): void {
  if (!world.state.caches.length) return;

  const { tick, map } = world.context;
  const activeMap = getHazardMap(map, world.state, tick);
  for (const cache of world.state.caches) {
    if (cache.guardianHealth <= 0) continue;

    advanceGuardian({ world, map: activeMap, cache });
  }
}

function advanceGuardian(turn: GuardianTurn): void {
  const { world, cache } = turn;
  const tick = world.context.tick;
  const intruders = findGuardianIntruders(turn);
  const adjacent = intruders.find((bot) => isWithinStrikeRange(cache, bot));
  if (!adjacent) moveGuardian(turn, intruders);
  if (tick < cache.nextAttackTick) return;

  const victim = intruders.find((bot) => {
    const inRange = isWithinStrikeRange(cache, bot);
    const exposed = isExposedBot(world, bot);
    return inRange && exposed;
  });
  if (victim) repelIntruder(turn, victim);
}

function findGuardianIntruders(turn: GuardianTurn): BotState[] {
  const { world, cache } = turn;

  return world.context.bots.filter((bot) => {
    const withinTerritory = manhattanDistance(bot.position, cache.position) <= DEFENSE_RADIUS;
    const inReach = withinTerritory || isWithinStrikeRange(cache, bot);
    const active = !bot.disabled && !isSafeBase(world, bot.position);

    return inReach && active;
  });
}

function isWithinStrikeRange(cache: GuardianCache, bot: BotState): boolean {
  return manhattanDistance(guardianPosition(cache), bot.position) <= 1;
}

function moveGuardian(turn: GuardianTurn, intruders: BotState[]): void {
  const { cache, map, world } = turn;
  const tick = world.context.tick;
  if (tick < (cache.nextGuardianMoveTick ?? 0)) return;

  const position = guardianPosition(cache);
  const candidates = traversableNeighbors(map, position).filter((cell) => {
    const inTerritory = manhattanDistance(cell, cache.position) <= DEFENSE_RADIUS;
    const inSafeArea = isSafeBase(world, cell);

    return inTerritory && !inSafeArea;
  });
  const target = nearestPosition(
    position,
    intruders.map((bot) => bot.position),
  );
  const destination = target ? nearestPosition(target, candidates) : patrolStep(candidates, tick);
  if (!destination) return;

  cache.guardianPosition = destination;
  cache.nextGuardianMoveTick = tick + 2;
}

function repelIntruder(turn: GuardianTurn, bot: BotState): void {
  const { world, cache } = turn;
  const impactPosition = bot.position;
  interruptBot(world, bot);
  countWorldAction(world, bot.id, "guardianRepels");
  bot.position = findRepelledPosition(turn, bot);
  bot.lastAction = `Repelled by ${cache.id} guardian`;
  cache.nextAttackTick = world.context.tick + 3;

  if (!samePosition(impactPosition, bot.position)) cancelCapture(world, bot.id);
  recordWorldEvent(world, {
    message: `${cache.id} guardian repelled ${bot.name}`,
    position: impactPosition,
    effect: "strike",
  });
}

function findRepelledPosition(turn: GuardianTurn, bot: BotState): Position {
  const queue = [bot.position];
  const visited = new Set([positionKey(bot.position)]);
  const initialDistance = manhattanDistance(bot.position, turn.cache.position);
  const retreatDistance = Math.max(DEFENSE_RADIUS + 1, initialDistance + MIN_RETREAT_DISTANCE);
  let farthest = bot.position;
  for (let index = 0; index < queue.length; index++) {
    const position = queue[index]!;
    farthest = position;
    if (manhattanDistance(position, turn.cache.position) >= retreatDistance) return position;

    const unexplored = getOutwardSteps(turn, position).filter(
      (cell) => !visited.has(positionKey(cell)),
    );
    for (const cell of unexplored) {
      visited.add(positionKey(cell));
      queue.push(cell);
    }
  }

  return farthest;
}

function getOutwardSteps(turn: GuardianTurn, position: Position): Position[] {
  const { world, cache, map } = turn;
  const distance = manhattanDistance(position, cache.position);
  const guardian = guardianPosition(cache);
  const candidates = traversableNeighbors(map, position).filter((cell) => {
    const movesOutward = manhattanDistance(cell, cache.position) > distance;
    const protectedTile = isSafeBase(world, cell);
    const occupied = world.context.bots.some((bot) => samePosition(bot.position, cell));

    return movesOutward && !protectedTile && !occupied;
  });

  return candidates.sort(
    (first, second) => manhattanDistance(second, guardian) - manhattanDistance(first, guardian),
  );
}

function cancelCapture(world: WorldTurn, botId: string): void {
  for (const depot of world.context.outposts) {
    if (depot.capturingBotId !== botId) continue;

    depot.capturingBotId = null;
    depot.captureProgress = 0;
  }
}
