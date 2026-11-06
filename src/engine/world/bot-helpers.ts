import { getMoveOptions } from "../bot-helpers.ts";
import { getNearestBank } from "../competition.ts";
import { manhattanDistance } from "../grid.ts";
import { DIRECTIONS, inventoryWeight, samePosition, terrainCost } from "../pathfinding.ts";
import { RESOURCES, type Action, type Observation, type Position } from "../types.ts";
import { canDeployCargoTrap } from "./cargo-traps.ts";
import { canSabotageDepot } from "./depot-sabotage.ts";
import { guardianPosition, type WorldTurn } from "./types.ts";

function observationTurn(state: Observation): WorldTurn {
  return { state: state.world, context: { ...state, events: [] } };
}

function isReady(state: Observation): boolean {
  const isActive = !state.self.disabled;
  const hasFinishedTravel = state.self.travelRemaining === 0;
  const hasTurnsRemaining = state.remainingTicks > 0;

  return isActive && hasFinishedTravel && hasTurnsRemaining;
}

export function canSabotage(state: Observation, targetId: string): boolean {
  if (!isReady(state)) return false;

  const outpost = state.outposts.find((site) => site.id === targetId);
  if (!outpost) return false;

  return canSabotageDepot(observationTurn(state), state.self, outpost);
}

export function canRepair(state: Observation, targetId: string): boolean {
  if (!isReady(state)) return false;

  const outpost = state.outposts.find((site) => site.id === targetId);
  if (!outpost) return false;

  const bankingDisabled = (outpost.disabledUntilTick ?? 0) > state.tick;
  const isOwned = outpost.ownerId === state.self.id;
  const withinRepairRange = manhattanDistance(state.self.position, outpost) <= 1;

  return isOwned && bankingDisabled && withinRepairRange;
}

export function canDeployTrap(state: Observation): boolean {
  if (!isReady(state)) return false;

  return canDeployCargoTrap(observationTurn(state), state.self);
}

export function canClearTrap(state: Observation, targetId: string): boolean {
  if (!isReady(state)) return false;

  const trap = state.world.traps.find((site) => site.id === targetId);
  if (!trap) return false;

  return manhattanDistance(state.self.position, trap) <= 1;
}

export function canStrike(state: Observation, targetId: string): boolean {
  if (!isReady(state)) return false;

  const drone = state.world.drones.find((enemy) => {
    const matchesTarget = enemy.id === targetId;
    const isAlive = enemy.health > 0;

    return matchesTarget && isAlive;
  });
  const cache = state.world.caches.find((site) => {
    const matchesTarget = site.id === targetId;
    const guardianIsAlive = site.guardianHealth > 0;

    return matchesTarget && guardianIsAlive;
  });
  const target = drone?.position ?? (cache ? guardianPosition(cache) : undefined);
  if (!target) return false;

  return manhattanDistance(state.self.position, target) <= 1;
}

export function canLootCache(state: Observation, targetId: string): boolean {
  if (!isReady(state)) return false;

  const cache = state.world.caches.find((site) => site.id === targetId);
  if (!cache) return false;

  const kind = cache.inventory[0];
  if (!kind) return false;

  const guardianDefeated = cache.guardianHealth === 0;
  const standingOnCache = samePosition(state.self.position, cache.position);
  const itemFits = inventoryWeight(state.self.inventory) + RESOURCES[kind].weight <= state.capacity;

  return guardianDefeated && standingOnCache && itemFits;
}

export function getHazardsAt(state: Observation, position: Position) {
  return state.world.hazards.filter((hazard) => {
    const hasNotExpired = hazard.endsAt > state.tick;
    const coversPosition = hazard.cells.some((cell) => samePosition(cell, position));

    return hasNotExpired && coversPosition;
  });
}

export function getDefensiveAction(state: Observation): Action | undefined {
  if (!isReady(state)) return;

  const imminent = getHazardsAt(state, state.self.position).some(
    (hazard) => hazard.startsAt <= state.tick + 2,
  );
  if (imminent) return escapeThreat(state);

  const trap = state.world.traps.find((site) => {
    const belongsToRival = site.ownerId !== state.self.id;
    const sharesTile = samePosition(site, state.self.position);
    const notArmed = site.armedAt > state.tick;
    return belongsToRival && sharesTile && notArmed;
  });
  const carrying = state.self.inventory.length > 0;
  if (trap && carrying) return { type: "clearTrap", targetId: trap.id };

  const droneEscape = avoidScavenger(state);
  if (droneEscape) return droneEscape;

  const guardian = state.world.caches.find((cache) => canStrike(state, cache.id));
  if (guardian && carrying) return escapeThreat(state, guardianPosition(guardian));
}

function avoidScavenger(state: Observation): Action | undefined {
  const position = state.self.position;
  const protectedAtBase = state.bots.some((bot) => manhattanDistance(bot.base, position) <= 3);
  const guarding = isGuarding(state);
  if (protectedAtBase || guarding) return;

  const threats = state.world.drones.filter((drone) => {
    const ready = drone.health > 0 && (drone.nextAttackTick ?? 0) <= state.tick;
    const distance = manhattanDistance(drone.position, position);
    const withinReach = distance === 0 || (distance === 1 && drone.nextMoveTick <= state.tick + 1);
    return ready && withinReach;
  });
  if (!threats.length) return;

  const escape = getMoveOptions(state)
    .filter(({ passable, destination }) => {
      const outsideReach = threats.every(
        (drone) => manhattanDistance(drone.position, destination) > 1,
      );
      const hazardFree = getHazardsAt(state, destination).every(
        (hazard) => hazard.startsAt > state.tick + 2,
      );
      return passable && outsideReach && hazardFree;
    })
    .sort((first, second) => first.cost - second.cost)[0];
  return escape ? { type: "move", direction: escape.direction } : { type: "guard" };
}

/** Guard before an intended step onto a drone that can attack on arrival. */
export function protectDroneCrossing(state: Observation, action: Action): Action {
  const isMovement = action.type === "move" || action.type === "home";
  const guarded = isGuarding(state);
  if (!isMovement || guarded) return action;

  const drones = state.world.drones.filter((drone) => {
    const inRange = manhattanDistance(drone.position, state.self.position) <= 2;
    const canAttack = drone.health > 0 && (drone.nextAttackTick ?? 0) <= state.tick + 1;
    return inRange && canAttack;
  });
  if (!drones.length) return action;

  const direction =
    action.type === "move" ? action.direction : getNearestBank(state)?.route.steps[0];
  const destination = getMoveOptions(state).find((option) => option.direction === direction);
  if (!destination?.passable) return action;

  const protectedAtBase = state.bots.some(
    (bot) => manhattanDistance(bot.base, destination.destination) <= 3,
  );
  if (protectedAtBase) return action;
  const danger = drones.some((drone) => {
    const distance = manhattanDistance(drone.position, destination.destination);
    const sharesTile = distance === 0;
    const approachesBeforeNextAction =
      distance === 1 && drone.nextMoveTick < state.tick + destination.cost;
    return sharesTile || approachesBeforeNextAction;
  });
  return danger ? { type: "guard" } : action;
}

function isGuarding(state: Observation): boolean {
  return state.world.defenses.some((defense) => {
    const ownsGuard = defense.botId === state.self.id;
    const isActive = defense.guardedUntilTick > state.tick;
    return ownsGuard && isActive;
  });
}

function escapeThreat(state: Observation, enemy?: Position): Action {
  const candidates = Object.entries(DIRECTIONS)
    .map(([direction, delta]) => ({
      direction: direction as keyof typeof DIRECTIONS,
      position: { x: state.self.position.x + delta.x, y: state.self.position.y + delta.y },
    }))
    .filter(({ position }) => Number.isFinite(terrainCost(state.map, position)));
  const safe = candidates.filter(({ position }) =>
    getHazardsAt(state, position).every((hazard) => hazard.startsAt > state.tick + 2),
  );
  const options = safe.length ? safe : candidates;
  const centers = enemy
    ? [enemy]
    : getHazardsAt(state, state.self.position).map((hazard) => hazard.center);
  const distance = (position: Position) =>
    centers.reduce((sum, center) => sum + manhattanDistance(position, center), 0);
  options.sort((first, second) => distance(second.position) - distance(first.position));

  return options[0] ? { type: "move", direction: options[0].direction } : { type: "guard" };
}

/** Block a ready guardian before a nonlethal strike. A finishing blow needs no guard. */
export function getGuardianFightAction(state: Observation, targetId: string): Action | undefined {
  const cache = state.world.caches.find((site) => site.id === targetId);
  const inRange = canStrike(state, targetId);
  if (!cache || !inRange) return;

  const canRetaliate = cache.guardianHealth > 1 && cache.nextAttackTick <= state.tick;
  const guarding = isGuarding(state);
  return canRetaliate && !guarding ? { type: "guard" } : { type: "strike", targetId };
}

export function getCompetitiveAction(state: Observation): Action | undefined {
  if (!isReady(state)) return;

  const repair = state.outposts.find((outpost) => canRepair(state, outpost.id));
  if (repair) return { type: "repair", targetId: repair.id };

  const sabotage = state.outposts.find((outpost) => canSabotage(state, outpost.id));
  if (sabotage) return { type: "sabotage", targetId: sabotage.id };

  const cache = state.world.caches.find((site) => canLootCache(state, site.id));
  if (cache) return { type: "lootCache", targetId: cache.id };

  const guardian = state.world.caches.find((site) => canStrike(state, site.id));
  const emptyBag = state.self.inventory.length === 0;
  if (guardian && emptyBag) return getGuardianFightAction(state, guardian.id);

  return getTrapAction(state);
}

/** Trap a loaded rival's likely path to a bank, or the tile it is already using. */
export function getTrapAction(state: Observation): Action | undefined {
  const timeToArm = state.remainingTicks >= 3;
  const canPlace = canDeployTrap(state);
  if (!canPlace || !timeToArm) return;

  const position = state.self.position;
  const exposedRival = state.bots.some((rival) => {
    const isOpponent = rival.id !== state.self.id;
    const isActive = !rival.disabled;
    const carriesCargo = rival.inventory.length > 0;
    const loadedOpponent = isOpponent && isActive && carriesCargo;
    const nearby = manhattanDistance(rival.position, position) <= 4;
    if (!loadedOpponent || !nearby) return false;
    return crossesTrapTile(state, rival);
  });
  if (exposedRival) return { type: "deployTrap" };
}

function crossesTrapTile(state: Observation, rival: Observation["self"]): boolean {
  const trap = state.self.position;
  if (samePosition(rival.position, trap)) return true;

  const bank = getNearestBank({ ...state, self: rival });
  let position = rival.position;
  for (const step of bank?.route.steps.slice(0, 4) ?? []) {
    const delta = DIRECTIONS[step];
    position = { x: position.x + delta.x, y: position.y + delta.y };
    if (samePosition(position, trap)) return true;
  }
  return false;
}
