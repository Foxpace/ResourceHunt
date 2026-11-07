import { manhattanDistance } from "../grid.ts";
import { DIRECTIONS, findPath, samePosition } from "../pathfinding.ts";
import type { BotState, Direction, Position } from "../types.ts";
import { DroneMinds, retireDrone, type DroneMind } from "./drone-minds.ts";
import { nearestPosition, patrolStep, traversableNeighbors } from "./neutral-movement.ts";
import { getHazardMap } from "./hazard-map.ts";
import {
  countWorldAction,
  dropResource,
  isExposedBot,
  isSafeBase,
  recordWorldEvent,
} from "./shared.ts";
import type { ScavengerDrone, WorldTurn } from "./types.ts";

const STOLEN_CARGO_LIFETIME = 8;
const DRONE_CARGO_CAPACITY = 4;
const DETECTION_RANGE = 6;
const PATROL_RADIUS = 3;
const PATROL_MOVE_INTERVAL = 3;
const PURSUIT_MOVE_INTERVAL = 2;

export function advanceScavengerDrones(turn: WorldTurn, minds: DroneMinds): void {
  for (const drone of turn.state.drones) {
    const destroyed = drone.health <= 0;
    if (destroyed) continue;

    const mind = minds.mindOf(turn, drone);
    strikeAndRetire(turn, drone, mind);
    const waitingToMove = drone.nextMoveTick > turn.context.tick;
    if (waitingToMove) continue;

    moveScavengerDrone(turn, drone, mind);
    strikeAndRetire(turn, drone, mind);

    const interval = mind.pursuing ? PURSUIT_MOVE_INTERVAL : PATROL_MOVE_INTERVAL;
    drone.nextMoveTick = turn.context.tick + interval;
  }
}

function strikeAndRetire(turn: WorldTurn, drone: ScavengerDrone, mind: DroneMind): void {
  const struck = attackExposedBot(turn, drone);
  if (struck) retireDrone(mind, turn.context.tick);
}

export function releaseDroneCargo(turn: WorldTurn, drone: ScavengerDrone): void {
  for (const kind of drone.inventory) dropResource(turn, drone.position, kind);

  clearDroneCargo(drone);
  drone.route = [];
}

function clearDroneCargo(drone: ScavengerDrone): void {
  drone.inventory = [];
  delete drone.unloadCargoAtTick;
}

export function expireStolenDroneCargo(turn: WorldTurn): void {
  for (const drone of turn.state.drones) {
    const expiresAt = drone.unloadCargoAtTick;
    if (expiresAt === undefined) continue;

    const cargoExpired = turn.context.tick >= expiresAt;
    if (cargoExpired) clearDroneCargo(drone);
  }
}

function moveScavengerDrone(turn: WorldTurn, drone: ScavengerDrone, mind: DroneMind): void {
  const beyondLeash = manhattanDistance(drone.position, mind.home) > mind.leash;
  if (beyondLeash) retireDrone(mind, turn.context.tick);

  const target = chooseDroneTarget(turn, drone, mind);
  const goal = target ?? returnPoint(drone, mind);
  const map = getHazardMap(turn.context.map, turn.state, turn.context.tick);
  const route = goal ? findPath(map, drone.position, goal) : null;
  mind.pursuing = !!target;
  if (route?.steps.length) {
    followRoute(drone, route.steps);
    return;
  }

  drone.route = [];
  const atGoal = goal ? samePosition(drone.position, goal) : false;
  if (!atGoal) patrolDrone(turn, drone, mind);
}

function followRoute(drone: ScavengerDrone, steps: Direction[]): void {
  let position = { ...drone.position };
  drone.route = steps.slice(0, 32).map((direction) => {
    const delta = DIRECTIONS[direction];
    position = { x: position.x + delta.x, y: position.y + delta.y };

    return position;
  });
  const next = drone.route.shift();
  if (next) drone.position = next;
}

function returnPoint(drone: ScavengerDrone, mind: DroneMind): Position | undefined {
  const farFromHome = manhattanDistance(drone.position, mind.home) > PATROL_RADIUS;

  return farFromHome ? mind.home : undefined;
}

function patrolDrone(turn: WorldTurn, drone: ScavengerDrone, mind: DroneMind): void {
  const map = getHazardMap(turn.context.map, turn.state, turn.context.tick);
  const candidates = traversableNeighbors(map, drone.position).filter((position) => {
    const safeBase = isSafeBase(turn, position);
    const nearHome = manhattanDistance(position, mind.home) <= PATROL_RADIUS;

    return !safeBase && nearHome;
  });
  const next = patrolStep(candidates, turn.context.tick);
  if (next) drone.position = next;
}

function chooseDroneTarget(
  turn: WorldTurn,
  drone: ScavengerDrone,
  mind: DroneMind,
): Position | undefined {
  const coolingDown = turn.context.tick < mind.retryAtTick;
  if (coolingDown) return;

  const targets = turn.context.bots.filter((bot) => {
    const exposed = isExposedBot(turn, bot);
    const withinDetectionRange = manhattanDistance(bot.position, drone.position) <= DETECTION_RANGE;

    return exposed && withinDetectionRange;
  });

  return nearestPosition(
    drone.position,
    preferLoadedTargets(drone, targets).map((bot) => bot.position),
  );
}

function preferLoadedTargets(drone: ScavengerDrone, targets: BotState[]): BotState[] {
  if (drone.inventory.length >= DRONE_CARGO_CAPACITY) return targets;

  const loadedTargets = targets.filter((bot) => bot.inventory.length > 0);
  return loadedTargets.length ? loadedTargets : targets;
}

function attackExposedBot(turn: WorldTurn, drone: ScavengerDrone): boolean {
  const tick = turn.context.tick;
  const attackCoolingDown = tick < (drone.nextAttackTick ?? 0);
  if (attackCoolingDown) return false;

  const targets = turn.context.bots.filter((bot) => {
    const exposed = isExposedBot(turn, bot);
    const sharesDroneTile = samePosition(bot.position, drone.position);

    return exposed && sharesDroneTile;
  });
  const victim = preferLoadedTargets(drone, targets)[0];
  if (!victim) return false;

  drone.nextAttackTick = tick + 6;
  countWorldAction(turn, victim.id, "droneStuns");
  victim.travelRemaining = Math.max(victim.travelRemaining, 1);
  victim.lastAction = `Stunned by ${drone.id}`;
  const stolenResource = stealBotCargo(turn, drone, victim);
  const attackResult = stolenResource ? `stole ${stolenResource} from` : "stunned";
  recordWorldEvent(turn, {
    message: `${drone.id} ${attackResult} ${victim.name}`,
    position: victim.position,
    effect: "strike",
  });

  return true;
}

function stealBotCargo(turn: WorldTurn, drone: ScavengerDrone, victim: BotState) {
  const cargoBayFull = drone.inventory.length >= DRONE_CARGO_CAPACITY;
  if (cargoBayFull) return;

  const stolenResource = victim.inventory.pop();
  if (!stolenResource) return;

  drone.inventory.push(stolenResource);
  drone.unloadCargoAtTick ??= turn.context.tick + STOLEN_CARGO_LIFETIME;
  victim.lost++;

  return stolenResource;
}
