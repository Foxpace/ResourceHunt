import {
  DEFAULT_WORLD_RULES,
  type WorldRules,
  type WorldState,
  type VisualEffect,
} from "./world/types.ts";
export type Position = { x: number; y: number };
export type Direction = "N" | "W" | "E" | "S";
export type Biome =
  "riverlands" | "valley" | "desert" | "moon" | "volcanic" | "archipelago" | "tundra" | "forest";
export type Terrain =
  | "grass"
  | "forest"
  | "mountain"
  | "water"
  | "bridge"
  | "sand"
  | "dune"
  | "oasis"
  | "regolith"
  | "crater"
  | "cliff"
  | "basalt"
  | "ash"
  | "lava"
  | "snow"
  | "ice"
  | "thicket";
export type ResourceKind = "ore" | "crystal" | "relic";
export type Action =
  | { type: "move"; direction: Direction }
  | { type: "grab" }
  | { type: "skip" }
  | { type: "home" }
  | { type: "capture" }
  | { type: "guard" }
  | { type: "deployTrap" }
  | { type: "sabotage" | "repair" | "clearTrap" | "strike" | "lootCache"; targetId: string }
  | { type: "steal"; targetId: string };

export const TERRAIN_COST: Record<Terrain, number> = {
  grass: 1,
  forest: 2,
  mountain: 3,
  water: Infinity,
  bridge: 1,
  sand: 2,
  dune: 3,
  oasis: 1,
  regolith: 1,
  crater: 2,
  cliff: Infinity,
  basalt: 1,
  ash: 2,
  lava: Infinity,
  snow: 2,
  ice: 1,
  thicket: Infinity,
};
export const RESOURCES: Record<ResourceKind, { value: number; weight: number; color: string }> = {
  ore: { value: 2, weight: 1, color: "#e3b46c" },
  crystal: { value: 7, weight: 2, color: "#75ded4" },
  relic: { value: 14, weight: 3, color: "#c5a2ff" },
};
export const MAX_BOTS = 15;
export const BOT_COLORS = [
  "#fb926b",
  "#77d5c5",
  "#b5a1f4",
  "#e3ca78",
  "#77b9ef",
  "#ec98ba",
  "#c0d782",
  "#d7b59c",
  "#91c8a0",
  "#efb479",
  "#a1b5ea",
  "#d891e0",
  "#d4df98",
  "#a7d6db",
  "#edaca5",
];
export interface GameConfig extends WorldRules {
  biome: Biome;
  width: number;
  height: number;
  ticks: number;
  seed: string;
  baseLayout: "edges" | "center";
  resourceDensity: number;
  terrainDensity: number;
  capacity: number;
  decisionTimeoutMs: number;
  hotspotCount: number;
  outpostCount: number;
  captureTurns: number;
  captureImmunityTicks: number;
  stealing: boolean;
  stealCooldownTicks: number;
}
export const DEFAULT_CONFIG: GameConfig = {
  ...DEFAULT_WORLD_RULES,
  biome: "riverlands",
  width: 33,
  height: 25,
  ticks: 300,
  seed: "resource-hunt",
  baseLayout: "edges",
  resourceDensity: 0.13,
  terrainDensity: 0.28,
  capacity: 8,
  decisionTimeoutMs: 100,
  hotspotCount: 2,
  outpostCount: 2,
  captureTurns: 3,
  captureImmunityTicks: 3,
  stealing: true,
  stealCooldownTicks: 5,
};
export interface GameMap {
  width: number;
  height: number;
  tiles: Terrain[][];
}
export interface ResourcePile extends Position {
  kind: ResourceKind;
  amount: number;
  hotspotId?: string;
}
export interface Hotspot extends Position {
  id: string;
  radius: number;
}
export interface Outpost extends Position {
  id: string;
  ownerId: string | null;
  capturingBotId: string | null;
  captureProgress: number;
  disabledUntilTick?: number;
  sabotageProtectedUntilTick?: number;
  captureProtectedUntilTick?: number;
  // Progress fields are retained for version 1 replays recorded under the old rules.
  sabotagingBotId?: string | null;
  sabotageProgress?: number;
}
export const THEFT_PROTECTION_TICKS = 2;
export interface BotMetadata {
  id: string;
  strategyId?: string;
  name: string;
  description: string;
}
export interface BotState extends BotMetadata {
  color: string;
  position: Position;
  base: Position;
  inventory: ResourceKind[];
  score: number;
  delivered: number;
  travelRemaining: number;
  errors: number;
  lastAction: string;
  disabled: boolean;
  stealReadyTick: number;
  theftProtectedUntilTick: number;
  captures: number;
  stolen: number;
  lost: number;
}
export interface GameEvent {
  tick: number;
  botId: string;
  message: string;
  kind: "action" | "score" | "error" | "world";
  position?: Position;
  effect?: VisualEffect;
}
export interface Frame {
  statistics?: Record<string, Partial<import("./match-statistics.ts").MatchStatistics>>;
  world: WorldState;
  tick: number;
  bots: BotState[];
  resources: ResourcePile[];
  hotspots: Hotspot[];
  outposts: Outpost[];
  events: GameEvent[];
  finished: boolean;
}
export interface Snapshot extends Frame {
  config: GameConfig;
  map: GameMap;
}
export interface Observation {
  world: WorldState;
  config: GameConfig;
  tick: number;
  maxTicks: number;
  remainingTicks: number;
  capacity: number;
  map: GameMap;
  resources: ResourcePile[];
  hotspots: Hotspot[];
  outposts: Outpost[];
  bots: BotState[];
  self: BotState;
}
export interface BotContext {
  random: () => number;
}
export interface Bot {
  act(observation: Observation): Action | Promise<Action>;
}
export interface BotConstructor {
  new (context: BotContext): Bot;
  metadata: BotMetadata;
}
export interface Decision {
  action: unknown;
  error?: string;
  disabled?: boolean;
}
export interface BotController {
  metadata: BotMetadata;
  decide(observation: Observation): Promise<Decision>;
  dispose(): void;
}
export interface Standing {
  statistics?: import("./match-statistics.ts").MatchStatistics;
  rank: number;
  id: string;
  name: string;
  score: number;
  delivered: number;
  carriedValue: number;
  errors: number;
  disabled: boolean;
  captures: number;
  outpostsOwned: number;
  stolen: number;
  lost: number;
}
export interface MatchResult {
  config: GameConfig;
  botOrder: string[];
  ticks: number;
  standings: Standing[];
  resourceUnitsLeft: number;
}
export interface Replay {
  version: 1;
  initial: Snapshot;
  frames: Frame[];
  result: MatchResult;
}
