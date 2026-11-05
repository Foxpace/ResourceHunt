import { RESOURCES, type GameMap } from "./types.ts";
type RecordValue = Record<string, unknown>;

export function isRecord(value: unknown): value is RecordValue {
  const isPresent = value !== null;
  const isObject = typeof value === "object";
  const isArray = Array.isArray(value);

  return isPresent && isObject && !isArray;
}

export function isNonnegativeInteger(value: unknown): value is number {
  if (typeof value !== "number") return false;

  const isInteger = Number.isSafeInteger(value);
  const isNonnegative = value >= 0;

  return isInteger && isNonnegative;
}

export function isResourceKind(value: unknown): boolean {
  if (typeof value !== "string") return false;

  return Object.hasOwn(RESOURCES, value);
}

export function isPosition(value: unknown, map: GameMap): boolean {
  if (!isRecord(value)) return false;
  if (!isNonnegativeInteger(value.x)) return false;
  if (!isNonnegativeInteger(value.y)) return false;

  const insideColumns = value.x < map.width;
  const insideRows = value.y < map.height;

  return insideColumns && insideRows;
}

export function isSiteId(value: unknown): value is string {
  if (typeof value !== "string") return false;

  return /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
}

export function isBoundedArray(
  value: unknown,
  minimum: number,
  maximum: number,
): value is unknown[] {
  if (!Array.isArray(value)) return false;

  const meetsMinimum = value.length >= minimum;
  const withinMaximum = value.length <= maximum;

  return meetsMinimum && withinMaximum;
}
