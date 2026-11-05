import {
  isRecord,
  isPosition,
  isNonnegativeInteger,
  isResourceKind,
  isSiteId,
  isBoundedArray,
} from "../replay-guards.ts";
import type { GameMap } from "../types.ts";
import { HAZARD_KINDS, MAX_NATURAL_HAZARD_CELLS, type HazardKind } from "./types.ts";

interface WorldValidation {
  map: GameMap;
  botIds: string[];
}

type RecordValue = Record<string, unknown>;

export function isValidWorldState(value: unknown, context: WorldValidation): boolean {
  if (!isRecord(value)) return false;

  const trapsValid = isCollection(value.traps, 30, (trap) => isTrap(trap, context));
  const dronesValid = isCollection(value.drones, 6, (drone) => isDrone(drone, context));
  const cachesValid = isCollection(value.caches, 6, (cache) => isCache(cache, context));
  const sitesValid = trapsValid && dronesValid && cachesValid;

  const hazardsValid = isCollection(value.hazards, 3, (hazard) => isHazard(hazard, context));
  const defensesValid = isCollection(value.defenses, 15, (defense) => isDefense(defense, context));

  return sitesValid && hazardsValid && defensesValid;
}

function isCollection(
  value: unknown,
  maximum: number,
  validate: (item: unknown) => boolean,
): boolean {
  if (!isBoundedArray(value, 0, maximum)) return false;
  if (!value.every(validate)) return false;

  const identifiers = value.map((item) => (item as RecordValue).id ?? (item as RecordValue).botId);

  return new Set(identifiers).size === identifiers.length;
}

function isCargo(value: unknown): boolean {
  if (!isBoundedArray(value, 0, 4)) return false;

  return value.every(isResourceKind);
}

function isKnownBot(value: unknown, context: WorldValidation): boolean {
  if (typeof value !== "string") return false;

  return context.botIds.includes(value);
}

function isBoundedInteger(value: unknown, maximum: number): boolean {
  if (!isNonnegativeInteger(value)) return false;

  return value <= maximum;
}

function isPositionList(
  value: unknown,
  context: WorldValidation,
  limits: [number, number],
): boolean {
  if (!isBoundedArray(value, ...limits)) return false;

  return value.every((position) => isPosition(position, context.map));
}

function isTrap(value: unknown, context: WorldValidation): boolean {
  if (!isRecord(value)) return false;
  if (!isNonnegativeInteger(value.armedAt)) return false;
  if (!isNonnegativeInteger(value.expiresAt)) return false;

  const idValid = isSiteId(value.id);
  const positionValid = isPosition(value, context.map);
  const ownerValid = isKnownBot(value.ownerId, context);
  const siteValid = idValid && positionValid && ownerValid;

  const expiresAfterArming = value.expiresAt > value.armedAt;
  const durationWithinLimit = value.expiresAt - value.armedAt <= 30;

  return siteValid && expiresAfterArming && durationWithinLimit;
}

function isDrone(value: unknown, context: WorldValidation): boolean {
  if (!isRecord(value)) return false;

  const idValid = isSiteId(value.id);
  const positionValid = isPosition(value.position, context.map);
  const healthValid = isBoundedInteger(value.health, 2);
  const identityAndHealthValid = idValid && positionValid && healthValid;

  const cargoValid = isCargo(value.inventory);
  const nextMoveValid = isNonnegativeInteger(value.nextMoveTick);
  const routeValid = isPositionList(value.route, context, [0, 32]);
  const movementAndCargoValid = cargoValid && nextMoveValid && routeValid;

  const timerOmitted = value.unloadCargoAtTick === undefined;
  const timerNonnegative = isNonnegativeInteger(value.unloadCargoAtTick);
  const unloadTimerValid = timerOmitted || timerNonnegative;

  const attackTickOmitted = value.nextAttackTick === undefined;
  const attackTickNonnegative = isNonnegativeInteger(value.nextAttackTick);
  const attackTickValid = attackTickOmitted || attackTickNonnegative;
  const timersValid = unloadTimerValid && attackTickValid;

  return identityAndHealthValid && movementAndCargoValid && timersValid;
}

function isCache(value: unknown, context: WorldValidation): boolean {
  if (!isRecord(value)) return false;

  const idValid = isSiteId(value.id);
  const positionValid = isPosition(value.position, context.map);
  const healthValid = isBoundedInteger(value.guardianHealth, 3);
  const siteValid = idValid && positionValid && healthValid;

  const cargoValid = isCargo(value.inventory);
  const nextAttackValid = isNonnegativeInteger(value.nextAttackTick);

  const cacheValid = siteValid && cargoValid && nextAttackValid;

  return cacheValid && isGuardianMovementValid(value, context);
}

function isGuardianMovementValid(value: RecordValue, context: WorldValidation): boolean {
  const legacyPosition = value.guardianPosition === undefined;
  const positionOnMap = isPosition(value.guardianPosition, context.map);
  const positionValid = legacyPosition || positionOnMap;
  const legacyMoveTick = value.nextGuardianMoveTick === undefined;
  const moveTickNonnegative = isNonnegativeInteger(value.nextGuardianMoveTick);
  const moveTickValid = legacyMoveTick || moveTickNonnegative;

  return positionValid && moveTickValid;
}

function isHazard(value: unknown, context: WorldValidation): boolean {
  if (!isRecord(value)) return false;

  const idValid = isSiteId(value.id);
  const kindValid = HAZARD_KINDS.includes(value.kind as HazardKind);
  const identityValid = idValid && kindValid;

  const centerValid = isPosition(value.center, context.map);
  const cellsValid = isPositionList(value.cells, context, [1, MAX_NATURAL_HAZARD_CELLS]);
  const areaValid = centerValid && cellsValid;
  const scheduleValid = isHazardSchedule(value);

  return identityValid && areaValid && scheduleValid;
}

function isHazardSchedule(value: RecordValue): boolean {
  if (!isNonnegativeInteger(value.announcedAt)) return false;
  if (!isNonnegativeInteger(value.startsAt)) return false;
  if (!isNonnegativeInteger(value.endsAt)) return false;

  const announcedBeforeImpact = value.startsAt >= value.announcedAt;
  const endsAfterImpact = value.endsAt > value.startsAt;
  const durationWithinLimit = value.endsAt - value.startsAt <= 12;

  return announcedBeforeImpact && endsAfterImpact && durationWithinLimit;
}

function isDefense(value: unknown, context: WorldValidation): boolean {
  if (!isRecord(value)) return false;

  const botValid = isKnownBot(value.botId, context);
  const guardExpiryValid = isNonnegativeInteger(value.guardedUntilTick);
  const toolsReadyTickValid = isNonnegativeInteger(value.toolsReadyTick);

  return botValid && guardExpiryValid && toolsReadyTickValid;
}
