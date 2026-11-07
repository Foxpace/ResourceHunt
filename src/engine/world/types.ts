import type {
  Action,
  BotState,
  GameConfig,
  GameEvent,
  GameMap,
  Hotspot,
  Outpost,
  Position,
  ResourceKind,
  ResourcePile,
} from "../types.ts";

export interface WorldRules {
  sabotage: boolean;
  cargoTraps: boolean;
  scavengerCount: number;
  guardianCount: number;
  naturalEvents: boolean;
}

export const DEFAULT_WORLD_RULES: WorldRules = {
  sabotage: true,
  cargoTraps: true,
  scavengerCount: 2,
  guardianCount: 2,
  naturalEvents: true,
};
export const CLASSIC_WORLD_RULES: WorldRules = {
  sabotage: false,
  cargoTraps: false,
  scavengerCount: 0,
  guardianCount: 0,
  naturalEvents: false,
};

export type HazardKind =
  | "lava"
  | "boulders"
  | "meteors"
  | "storm"
  | "sandstorm"
  | "squall"
  | "blizzard"
  | "wildfire";
export const HAZARD_KINDS: HazardKind[] = [
  "lava",
  "boulders",
  "meteors",
  "storm",
  "sandstorm",
  "squall",
  "blizzard",
  "wildfire",
];
export const NATURAL_HAZARD_RADIUS = 5;
export const MAX_NATURAL_HAZARD_CELLS = 1 + 2 * NATURAL_HAZARD_RADIUS * (NATURAL_HAZARD_RADIUS + 1);

export const VISUAL_EFFECTS = [
  "bank",
  "collect",
  "capture",
  "steal",
  "sabotage",
  "trap",
  "guard",
  "strike",
  "impact",
  "loot",
  "error",
] as const;
export type VisualEffect = (typeof VISUAL_EFFECTS)[number];

export interface CargoTrap extends Position {
  id: string;
  ownerId: string;
  armedAt: number;
  expiresAt: number;
}

export interface ScavengerDrone {
  id: string;
  position: Position;
  health: number;
  inventory: ResourceKind[];
  route: Position[];
  nextMoveTick: number;
  nextAttackTick?: number;
  unloadCargoAtTick?: number;
}

export interface GuardianCache {
  id: string;
  position: Position;
  guardianHealth: number;
  guardianPosition?: Position;
  nextGuardianMoveTick?: number;
  inventory: ResourceKind[];
  nextAttackTick: number;
}

export function guardianPosition(cache: GuardianCache): Position {
  return cache.guardianPosition ?? cache.position;
}

export interface NaturalHazard {
  id: string;
  kind: HazardKind;
  center: Position;
  cells: Position[];
  announcedAt: number;
  startsAt: number;
  endsAt: number;
}

export interface BotDefense {
  botId: string;
  guardedUntilTick: number;
  toolsReadyTick: number;
}

export interface WorldState {
  traps: CargoTrap[];
  drones: ScavengerDrone[];
  caches: GuardianCache[];
  hazards: NaturalHazard[];
  defenses: BotDefense[];
}

export function createEmptyWorld(): WorldState {
  return { traps: [], drones: [], caches: [], hazards: [], defenses: [] };
}

export interface WorldContext {
  statistics?: Map<string, import("../match-statistics.ts").MatchStatistics>;
  tick: number;
  config: GameConfig;
  map: GameMap;
  bots: BotState[];
  resources: ResourcePile[];
  outposts: Outpost[];
  hotspots: Hotspot[];
  events: GameEvent[];
}

export interface WorldTurn {
  context: WorldContext;
  state: WorldState;
}

export interface WorldCommand {
  bot: BotState;
  action: Action;
}
