import { MAX_BOTS } from "./types.ts";
import { normalizeConfig } from "./config.ts";
import { RESOURCES, TERRAIN_COST, type GameMap, type Replay } from "./types.ts";

type RecordValue = Record<string, unknown>;

function invalidReplay(): never {
  throw new Error("Invalid replay file. Export a version 1 Resource hunt replay.");
}

function isRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isResourceKind(value: unknown): boolean {
  return typeof value === "string" && Object.hasOwn(RESOURCES, value);
}

function isPosition(value: unknown, map: GameMap): boolean {
  return (
    isRecord(value) &&
    isInteger(value.x) &&
    isInteger(value.y) &&
    value.x < map.width &&
    value.y < map.height
  );
}

function isBotState(value: unknown, map: GameMap): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    /^[a-z0-9][a-z0-9-]{0,47}$/.test(value.id) &&
    typeof value.name === "string" &&
    value.name.length <= 60 &&
    typeof value.color === "string" &&
    /^#[0-9a-f]{6}$/i.test(value.color) &&
    isPosition(value.position, map) &&
    isPosition(value.base, map) &&
    isInteger(value.score) &&
    isInteger(value.delivered) &&
    isInteger(value.errors) &&
    isInteger(value.travelRemaining) &&
    isInteger(value.stealReadyTick) &&
    isInteger(value.theftProtectedUntilTick) &&
    isInteger(value.captures) &&
    isInteger(value.stolen) &&
    isInteger(value.lost) &&
    typeof value.disabled === "boolean" &&
    typeof value.lastAction === "string" &&
    value.lastAction.length <= 240 &&
    Array.isArray(value.inventory) &&
    value.inventory.length <= 100 &&
    value.inventory.every(isResourceKind)
  );
}

function isResourcePile(value: unknown, map: GameMap): boolean {
  return (
    isRecord(value) &&
    isPosition(value, map) &&
    isResourceKind(value.kind) &&
    isInteger(value.amount) &&
    value.amount >= 1
  );
}

function isEvent(value: unknown, ids: string[]): boolean {
  return (
    isRecord(value) &&
    typeof value.botId === "string" &&
    ids.includes(value.botId) &&
    typeof value.message === "string" &&
    value.message.length <= 240 &&
    (value.kind === "score" || value.kind === "action" || value.kind === "error") &&
    isInteger(value.tick)
  );
}

function parseMap(value: unknown, width: number, height: number): GameMap {
  if (
    !isRecord(value) ||
    value.width !== width ||
    value.height !== height ||
    !Array.isArray(value.tiles) ||
    value.tiles.length !== height
  )
    invalidReplay();
  for (const row of value.tiles) {
    if (
      !Array.isArray(row) ||
      row.length !== width ||
      row.some((cell) => typeof cell !== "string" || !Object.hasOwn(TERRAIN_COST, cell))
    )
      invalidReplay();
  }
  return value as unknown as GameMap;
}

/** Validate replay data before letting the renderer use coordinates or terrain names. */
export function parseReplay(input: unknown): Replay {
  input = structuredClone(input);
  if (
    !isRecord(input) ||
    input.version !== 1 ||
    !isRecord(input.initial) ||
    !Array.isArray(input.frames) ||
    input.frames.length > 10000
  )
    invalidReplay();
  if (!isRecord(input.initial.config)) invalidReplay();
  const legacy = input.initial.hotspots === undefined && input.initial.outposts === undefined;
  const config = normalizeConfig({
    ...input.initial.config,
    ...(legacy ? { hotspotCount: 0, outpostCount: 0, stealing: false } : {}),
  });
  input.initial.config = config;
  const map = parseMap(input.initial.map, config.width, config.height);
  let ids: string[] = [];
  let previousTick = -1;
  let sites: string | undefined;

  for (const frame of [input.initial, ...input.frames] as unknown[]) {
    if (
      !isRecord(frame) ||
      !isInteger(frame.tick) ||
      frame.tick !== previousTick + 1 ||
      frame.tick > config.ticks ||
      frame.finished !== frame.tick >= config.ticks ||
      !Array.isArray(frame.bots) ||
      frame.bots.length < 1 ||
      frame.bots.length > MAX_BOTS ||
      !Array.isArray(frame.resources) ||
      frame.resources.length > map.width * map.height ||
      !Array.isArray(frame.events) ||
      frame.events.length > 32
    )
      invalidReplay();
    previousTick = frame.tick;
    if (legacy) {
      frame.hotspots ??= [];
      frame.outposts ??= [];
    }
    for (const bot of frame.bots) {
      if (!isRecord(bot)) invalidReplay();
      if (legacy)
        for (const field of [
          "stealReadyTick",
          "theftProtectedUntilTick",
          "captures",
          "stolen",
          "lost",
        ])
          bot[field] ??= 0;
    }
    if (!frame.bots.every((bot) => isBotState(bot, map))) invalidReplay();
    const frameIds = frame.bots.map((bot) => (bot as RecordValue).id as string);
    if (!ids.length) ids = frameIds;
    if (new Set(frameIds).size !== frameIds.length || frameIds.join(",") !== ids.join(","))
      invalidReplay();
    if (
      !Array.isArray(frame.hotspots) ||
      frame.hotspots.length > 6 ||
      !Array.isArray(frame.outposts) ||
      frame.outposts.length > 6
    )
      invalidReplay();
    const siteId = (value: unknown): value is string =>
      typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);
    const hotspotIds: string[] = [];
    const sitePositions: unknown[] = [];
    for (const hotspot of frame.hotspots) {
      if (
        !isRecord(hotspot) ||
        !siteId(hotspot.id) ||
        !isPosition(hotspot, map) ||
        !isInteger(hotspot.radius) ||
        hotspot.radius < 1 ||
        hotspot.radius > 4
      )
        invalidReplay();
      hotspotIds.push(hotspot.id);
      sitePositions.push([hotspot.id, hotspot.x, hotspot.y, hotspot.radius]);
    }
    const outpostIds: string[] = [];
    for (const post of frame.outposts) {
      if (
        !isRecord(post) ||
        !siteId(post.id) ||
        !isPosition(post, map) ||
        !isInteger(post.captureProgress) ||
        post.captureProgress >= config.captureTurns ||
        !(
          post.ownerId === null ||
          (typeof post.ownerId === "string" && ids.includes(post.ownerId))
        ) ||
        !(
          post.capturingBotId === null ||
          (typeof post.capturingBotId === "string" && ids.includes(post.capturingBotId))
        ) ||
        (post.capturingBotId === null && post.captureProgress !== 0)
      )
        invalidReplay();
      outpostIds.push(post.id);
      sitePositions.push([post.id, post.x, post.y]);
    }
    if (new Set([...hotspotIds, ...outpostIds]).size !== hotspotIds.length + outpostIds.length)
      invalidReplay();
    const positions = JSON.stringify(sitePositions);
    sites ??= positions;
    if (positions !== sites) invalidReplay();
    if (
      !frame.resources.every(
        (pile) =>
          isResourcePile(pile, map) &&
          (pile.hotspotId === undefined || hotspotIds.includes(pile.hotspotId)),
      ) ||
      !frame.events.every((event) => isEvent(event, ids))
    )
      invalidReplay();
  }
  if (!isRecord(input.result)) invalidReplay();
  input.result.config = config;
  if (legacy && Array.isArray(input.result.standings))
    for (const row of input.result.standings) {
      if (isRecord(row))
        for (const key of ["captures", "outpostsOwned", "stolen", "lost"]) row[key] ??= 0;
    }
  return input as unknown as Replay;
}
