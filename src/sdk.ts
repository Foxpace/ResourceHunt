/** Import this file from bot classes. See docs/sdk.md for the SDK reference. */
export type {
  Biome,
  Action,
  Bot,
  BotContext,
  BotMetadata,
  BotState,
  Direction,
  GameMap,
  Observation,
  Position,
  ResourceKind,
  ResourcePile,
  Terrain,
  Hotspot,
  Outpost,
} from "./engine/types.ts";
export { RESOURCES, TERRAIN_COST, MAX_BOTS } from "./engine/types.ts";
export { THEFT_PROTECTION_TICKS } from "./engine/types.ts";
export {
  getBankingSites,
  getNearestBank,
  canCapture,
  getStealTargets,
  canSteal,
} from "./engine/competition.ts";
export type { BankingSite, BankingRoute, StealTarget } from "./engine/competition.ts";
export {
  findPath,
  distanceField,
  positionKey,
  samePosition,
  inventoryWeight,
  terrainCost,
  DIRECTIONS,
} from "./engine/pathfinding.ts";
export type { Route } from "./engine/pathfinding.ts";
export {
  getMoveOptions,
  getInventoryStats,
  canGrab,
  planTrip,
  getOpponentArrivalTimes,
} from "./engine/bot-helpers.ts";
export type {
  MoveOption,
  InventoryStats,
  TripPlan,
  TripFailure,
  OpponentArrivalTime,
} from "./engine/bot-helpers.ts";

export { BIOMES } from "./engine/biomes.ts";
export type { BiomeDefinition } from "./engine/biomes.ts";
