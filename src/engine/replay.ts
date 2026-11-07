import {
  isRecord,
  isNonnegativeInteger,
  isResourceKind,
  isPosition,
  isSiteId,
  isBoundedArray,
} from "./replay-guards.ts";
import { CLASSIC_WORLD_RULES, createEmptyWorld, VISUAL_EFFECTS } from "./world/types.ts";
import { isValidWorldState } from "./world/replay-validation.ts";
import { MAX_BOTS } from "./types.ts";
import { normalizeConfig } from "./config.ts";
import { TERRAIN_COST, type GameConfig, type GameMap, type Replay } from "./types.ts";

type RecordValue = Record<string, unknown>;

function rejectInvalidReplay(): never {
  throw new Error("Invalid replay file. Export a version 1 Resource hunt replay.");
}

function isBotState(value: unknown, map: GameMap): boolean {
  if (!isRecord(value)) return false;

  const identityValid = isBotIdentity(value);
  const positionValid = isPosition(value.position, map);
  const baseValid = isPosition(value.base, map);
  const locationAndIdentityValid = identityValid && positionValid && baseValid;

  const countersValid = isBotCounters(value);
  const statusValid = isBotStatus(value);

  return locationAndIdentityValid && countersValid && statusValid;
}

function isBoundedText(value: unknown, maximum: number): value is string {
  if (typeof value !== "string") return false;

  return value.length <= maximum;
}

function isBotIdentity(value: RecordValue): boolean {
  const idValid = isSiteId(value.id);
  const nameValid = isBoundedText(value.name, 60);
  const strategyOmitted = value.strategyId === undefined;
  const strategyKnown = isSiteId(value.strategyId);
  const strategyValid = strategyOmitted || strategyKnown;
  const identifiersValid = idValid && nameValid && strategyValid;

  if (typeof value.color !== "string") return false;
  const colorValid = /^#[0-9a-f]{6}$/i.test(value.color);

  return identifiersValid && colorValid;
}

function isBotCounters(value: RecordValue): boolean {
  const counters = [
    "score",
    "delivered",
    "errors",
    "travelRemaining",
    "stealReadyTick",
    "theftProtectedUntilTick",
    "captures",
    "stolen",
    "lost",
  ];

  return counters.every((field) => isNonnegativeInteger(value[field]));
}

function isBotStatus(value: RecordValue): boolean {
  const disabledFlagValid = typeof value.disabled === "boolean";
  const lastActionValid = isBoundedText(value.lastAction, 240);
  if (!isBoundedArray(value.inventory, 0, 100)) return false;
  const inventoryValid = value.inventory.every(isResourceKind);

  return disabledFlagValid && lastActionValid && inventoryValid;
}

function isResourcePile(value: unknown, map: GameMap): boolean {
  if (!isRecord(value)) return false;
  if (!isNonnegativeInteger(value.amount)) return false;

  const positionValid = isPosition(value, map);
  const resourceKindValid = isResourceKind(value.kind);
  const hasResources = value.amount >= 1;

  return positionValid && resourceKindValid && hasResources;
}

function isEvent(value: unknown, ids: string[], map: GameMap): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.botId !== "string") return false;

  const knownBot = ids.includes(value.botId);
  const worldEvent = value.botId === "world";
  const sourceValid = knownBot || worldEvent;
  const presentationValid = isEventPresentation(value, map);
  const tickValid = isNonnegativeInteger(value.tick);

  return sourceValid && presentationValid && tickValid;
}

function isEventPresentation(value: RecordValue, map: GameMap): boolean {
  const positionOmitted = value.position === undefined;
  const positionOnMap = isPosition(value.position, map);
  const positionValid = positionOmitted || positionOnMap;
  const effectOmitted = value.effect === undefined;
  const effectKnown = VISUAL_EFFECTS.includes(value.effect as (typeof VISUAL_EFFECTS)[number]);
  const effectValid = effectOmitted || effectKnown;
  const visualValid = positionValid && effectValid;

  const messageValid = isBoundedText(value.message, 240);
  const kindValid = ["score", "action", "error", "world"].includes(String(value.kind));

  return visualValid && messageValid && kindValid;
}

function parseReplayMap(value: unknown, width: number, height: number): GameMap {
  if (!isRecord(value)) rejectInvalidReplay();
  if (!Array.isArray(value.tiles)) rejectInvalidReplay();

  const dimensionsMatch = value.width === width && value.height === height;
  const rowCountMatches = value.tiles.length === height;
  if (!dimensionsMatch || !rowCountMatches) rejectInvalidReplay();

  for (const row of value.tiles) {
    if (!Array.isArray(row)) rejectInvalidReplay();

    const columnCountMatches = row.length === width;
    const hasValidTerrain = row.every(isTerrainName);
    if (!columnCountMatches || !hasValidTerrain) rejectInvalidReplay();
  }

  return value as unknown as GameMap;
}

/** Validate replay data before rendering coordinates or terrain names. */
export function parseReplay(input: unknown): Replay {
  const replay = cloneReplayEnvelope(input);
  const initial = replay.initial as RecordValue;
  if (!isRecord(initial.config)) rejectInvalidReplay();

  const legacy = initial.hotspots === undefined && initial.outposts === undefined;
  const legacyWorld = initial.world === undefined;
  const config = normalizeConfig({
    ...initial.config,
    ...(initial.config.captureImmunityTicks === undefined ? { captureImmunityTicks: 0 } : {}),
    ...(legacyWorld ? CLASSIC_WORLD_RULES : {}),
    ...(legacy ? { hotspotCount: 0, outpostCount: 0, stealing: false } : {}),
  });
  initial.config = config;
  const map = parseReplayMap(initial.map, config.width, config.height);
  const validator = new ReplayFrameValidator(map, config, {
    legacyCompetition: legacy,
    legacyWorld,
  });

  for (const frame of [initial, ...(replay.frames as unknown[])]) validator.validateFrame(frame);

  normalizeReplayResult(replay, config, legacy);

  return replay as unknown as Replay;
}

function cloneReplayEnvelope(input: unknown): RecordValue {
  const replay = structuredClone(input);
  if (!isRecord(replay)) rejectInvalidReplay();

  const supportedVersion = replay.version === 1;
  const hasInitialFrame = isRecord(replay.initial);
  const hasValidFrames = isBoundedArray(replay.frames, 0, 10000);
  if (!supportedVersion || !hasInitialFrame || !hasValidFrames) rejectInvalidReplay();

  return replay;
}

class ReplayFrameValidator {
  private ids: string[] = [];
  private previousTick = -1;
  private sites: string | undefined;

  constructor(
    private map: GameMap,
    private config: GameConfig,
    private options: { legacyCompetition: boolean; legacyWorld: boolean },
  ) {}

  validateFrame(value: unknown): void {
    const frame = this.validateFrameEnvelope(value);
    this.normalizeLegacyFrame(frame);
    this.validateBots(frame.bots as unknown[]);
    this.validateFrameStatistics(frame.statistics);
    if (!isValidWorldState(frame.world, { map: this.map, botIds: this.ids })) rejectInvalidReplay();
    const hotspotIds = this.validateSites(frame);
    const resourcesValid = (frame.resources as RecordValue[]).every((pile) =>
      this.isFrameResource(pile, hotspotIds),
    );
    const eventsValid = (frame.events as unknown[]).every((event) =>
      isEvent(event, this.ids, this.map),
    );
    if (!resourcesValid || !eventsValid) rejectInvalidReplay();
  }

  private validateFrameStatistics(value: unknown): void {
    if (value === undefined) return;
    if (!isRecord(value)) rejectInvalidReplay();

    for (const [id, counters] of Object.entries(value)) {
      const participant = this.ids.includes(id);
      const validCounters =
        isRecord(counters) && Object.values(counters).every(isNonnegativeInteger);
      if (!participant || !validCounters) rejectInvalidReplay();
    }
  }

  private validateFrameEnvelope(frame: unknown): RecordValue {
    if (!isRecord(frame)) rejectInvalidReplay();
    if (!isNonnegativeInteger(frame.tick)) rejectInvalidReplay();

    const tickValid = frame.tick === this.previousTick + 1 && frame.tick <= this.config.ticks;
    const finishedValid = frame.finished === frame.tick >= this.config.ticks;
    if (!tickValid || !finishedValid) rejectInvalidReplay();

    this.validateFrameCollections(frame);
    this.previousTick = frame.tick;

    return frame;
  }

  private validateFrameCollections(frame: RecordValue): void {
    const botsValid = isBoundedArray(frame.bots, 1, MAX_BOTS);
    const resourcesValid = isBoundedArray(frame.resources, 0, this.map.width * this.map.height);
    const eventsValid = isBoundedArray(frame.events, 0, 128);
    if (!botsValid || !resourcesValid || !eventsValid) rejectInvalidReplay();
  }

  private isFrameResource(pile: RecordValue, hotspotIds: string[]): boolean {
    return (
      isResourcePile(pile, this.map) &&
      (pile.hotspotId === undefined || hotspotIds.includes(pile.hotspotId as string))
    );
  }

  private isBotReference(value: unknown): boolean {
    if (value === null) return true;
    if (typeof value !== "string") return false;

    return this.ids.includes(value);
  }

  private validateHotspot(hotspot: unknown): asserts hotspot is RecordValue & { id: string } {
    if (!isRecord(hotspot)) rejectInvalidReplay();
    if (!isSiteId(hotspot.id)) rejectInvalidReplay();

    const positionValid = isPosition(hotspot, this.map);

    const radius = hotspot.radius;
    const integerRadius = isNonnegativeInteger(radius);
    const radiusValid = integerRadius ? radius >= 1 && radius <= 4 : false;
    if (!positionValid || !radiusValid) rejectInvalidReplay();
  }

  private normalizeLegacyFrame(frame: RecordValue): void {
    if (this.options.legacyWorld) frame.world ??= createEmptyWorld();
    if (this.options.legacyCompetition) {
      frame.hotspots ??= [];
      frame.outposts ??= [];
    }

    for (const bot of frame.bots as unknown[]) {
      if (!isRecord(bot)) rejectInvalidReplay();

      this.normalizeLegacyBot(bot);
    }
  }

  private normalizeLegacyBot(bot: RecordValue): void {
    if (this.options.legacyCompetition)
      for (const field of [
        "stealReadyTick",
        "theftProtectedUntilTick",
        "captures",
        "stolen",
        "lost",
      ])
        bot[field] ??= 0;
  }

  private validateBots(bots: unknown[]): void {
    if (!bots.every((bot) => isBotState(bot, this.map))) rejectInvalidReplay();

    const frameIds = bots.map((bot) => (bot as RecordValue).id as string);
    if (!this.ids.length) this.ids = frameIds;

    const botIdsChanged =
      new Set(frameIds).size !== frameIds.length || frameIds.join(",") !== this.ids.join(",");
    if (botIdsChanged) rejectInvalidReplay();
  }

  private validateSites(frame: RecordValue): string[] {
    if (!isBoundedArray(frame.hotspots, 0, 6)) rejectInvalidReplay();
    if (!isBoundedArray(frame.outposts, 0, 6)) rejectInvalidReplay();

    const sitePositions: unknown[] = [];
    const hotspotIds = this.validateHotspots(frame.hotspots, sitePositions);
    const outpostIds = this.validateOutposts(frame.outposts, sitePositions);
    if (new Set([...hotspotIds, ...outpostIds]).size !== hotspotIds.length + outpostIds.length)
      rejectInvalidReplay();

    const positions = JSON.stringify(sitePositions);
    this.sites ??= positions;
    if (positions !== this.sites) rejectInvalidReplay();

    return hotspotIds;
  }

  private validateHotspots(hotspots: unknown[], sitePositions: unknown[]): string[] {
    const hotspotIds: string[] = [];

    for (const hotspot of hotspots) {
      this.validateHotspot(hotspot);
      hotspotIds.push(hotspot.id);
      sitePositions.push([hotspot.id, hotspot.x, hotspot.y, hotspot.radius]);
    }

    return hotspotIds;
  }

  private validateOutposts(outposts: unknown[], sitePositions: unknown[]): string[] {
    const outpostIds: string[] = [];

    for (const post of outposts) {
      this.validateOutpost(post);
      outpostIds.push(post.id);
      sitePositions.push([post.id, post.x, post.y]);
    }

    return outpostIds;
  }

  private validateOutpost(post: unknown): asserts post is RecordValue & { id: string } {
    if (!isRecord(post)) rejectInvalidReplay();
    if (!isSiteId(post.id)) rejectInvalidReplay();

    const positionValid = isPosition(post, this.map);

    const progressValid =
      isNonnegativeInteger(post.captureProgress) && post.captureProgress < this.config.captureTurns;
    const participantsValid =
      this.isBotReference(post.ownerId) && this.isBotReference(post.capturingBotId);
    if (!positionValid || !progressValid || !participantsValid) rejectInvalidReplay();

    this.validateSabotageState(post);

    const captureConsistent = post.capturingBotId !== null || post.captureProgress === 0;
    if (!captureConsistent) rejectInvalidReplay();
  }
  private validateSabotageState(post: RecordValue): void {
    const disabledUntil = post.disabledUntilTick === undefined ? 0 : post.disabledUntilTick;
    const progress = post.sabotageProgress === undefined ? 0 : post.sabotageProgress;
    const saboteur = post.sabotagingBotId ?? null;
    const downtimeValid = isNonnegativeInteger(disabledUntil);
    const integerProgress = isNonnegativeInteger(progress);
    const progressValid = integerProgress ? progress <= 1 : false;
    const downtimeAndProgressValid = downtimeValid && progressValid;
    const immunity =
      post.captureProtectedUntilTick === undefined ? 0 : post.captureProtectedUntilTick;
    const saboteurAndImmunityValid =
      this.isBotReference(saboteur) && isNonnegativeInteger(immunity);
    const progressMatchesSaboteur = saboteur !== null || progress === 0;
    const sabotageProtectionValid = isNonnegativeInteger(
      post.sabotageProtectedUntilTick === undefined ? 0 : post.sabotageProtectedUntilTick,
    );
    if (!sabotageProtectionValid) rejectInvalidReplay();
    if (!downtimeAndProgressValid || !saboteurAndImmunityValid || !progressMatchesSaboteur)
      rejectInvalidReplay();
  }
}

function normalizeReplayResult(replay: RecordValue, config: GameConfig, legacy: boolean): void {
  if (!isRecord(replay.result)) rejectInvalidReplay();

  replay.result.config = config;
  const standings = replay.result.standings;

  const legacyStandingsPresent = legacy && Array.isArray(standings);
  if (legacyStandingsPresent) for (const row of standings) normalizeLegacyStanding(row);
}

function normalizeLegacyStanding(row: unknown): void {
  if (!isRecord(row)) return;

  for (const key of ["captures", "outpostsOwned", "stolen", "lost"]) row[key] ??= 0;
}

function isTerrainName(value: unknown): boolean {
  return typeof value === "string" && Object.hasOwn(TERRAIN_COST, value);
}
