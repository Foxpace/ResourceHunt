import { manhattanDistance } from "../grid.ts";
import { DIRECTIONS, findPath, samePosition } from "../pathfinding.ts";
import type { BotState, GameMap, Position } from "../types.ts";
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

export function advanceScavengerDrones(turn: WorldTurn): void {
  for (const drone of turn.state.drones) {
    const destroyed = drone.health <= 0;
    const waitingToMove = drone.nextMoveTick > turn.context.tick;
    if (destroyed || waitingToMove) continue;

    attackExposedBot(turn, drone);
    moveScavengerDrone(turn, drone);

    drone.nextMoveTick = turn.context.tick + 3;
  }
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

function moveScavengerDrone(turn: WorldTurn, drone: ScavengerDrone): void {
  const target = chooseDroneTarget(turn, drone);
  const map = getHazardMap(turn.context.map, turn.state, turn.context.tick);
  const route = target ? findPath(map, drone.position, target) : null;
  if (!route?.steps.length) {
    drone.route = [];
    const atTarget = target ? samePosition(drone.position, target) : false;
    if (atTarget) return;

    patrolDrone(turn, drone, map);
    return;
  }

  let position = { ...drone.position };
  drone.route = route.steps.slice(0, 32).map((direction) => {
    const delta = DIRECTIONS[direction];
    position = { x: position.x + delta.x, y: position.y + delta.y };

    return position;
  });
  const next = drone.route.shift();
  if (next) drone.position = next;
}

function patrolDrone(turn: WorldTurn, drone: ScavengerDrone, map: GameMap): void {
  const candidates = traversableNeighbors(map, drone.position).filter(
    (position) => !isSafeBase(turn, position),
  );
  const next = patrolStep(candidates, turn.context.tick);
  if (next) drone.position = next;
}

function chooseDroneTarget(turn: WorldTurn, drone: ScavengerDrone): Position | undefined {
  const targets = turn.context.bots.filter((bot) => {
    const exposed = isExposedBot(turn, bot);
    const withinDetectionRange = manhattanDistance(bot.position, drone.position) <= 6;

    return exposed && withinDetectionRange;
  });

  const hasCargoSpace = drone.inventory.length < DRONE_CARGO_CAPACITY;
  const loadedTargets = targets.filter((bot) => bot.inventory.length > 0);
  const loadedTargetsAvailable = loadedTargets.length > 0;
  const canPursueCargo = hasCargoSpace && loadedTargetsAvailable;
  const preferredTargets = canPursueCargo ? loadedTargets : targets;

  return nearestPosition(
    drone.position,
    preferredTargets.map((bot) => bot.position),
  );
}

function attackExposedBot(turn: WorldTurn, drone: ScavengerDrone): void {
  const tick = turn.context.tick;
  const attackCoolingDown = tick < (drone.nextAttackTick ?? 0);
  if (attackCoolingDown) return;

  const victim = turn.context.bots.find((bot) => {
    const exposed = isExposedBot(turn, bot);
    const sharesDroneTile = samePosition(bot.position, drone.position);

    return exposed && sharesDroneTile;
  });
  if (!victim) return;

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
