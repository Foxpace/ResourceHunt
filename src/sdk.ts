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
  isOutpostProtected,
  getStealTargets,
  canSteal,
} from "./engine/competition.ts";
export type { BankingSite, BankingRoute, StealTarget } from "./engine/competition.ts";
export {
  findPath,
  findNearestRoute,
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
  findBestTrip,
  getOpponentArrivalTimes,
} from "./engine/bot-helpers.ts";
export type {
  MoveOption,
  InventoryStats,
  TripPlan,
  TripFailure,
  OpponentArrivalTime,
  OpponentArrivalTicks,
} from "./engine/bot-helpers.ts";

export { BIOMES } from "./engine/biomes.ts";
export type { BiomeDefinition } from "./engine/biomes.ts";

export {
  canSabotage,
  canRepair,
  canDeployTrap,
  canClearTrap,
  canStrike,
  getGuardianFightAction,
  canLootCache,
  getHazardsAt,
  getDefensiveAction,
  protectDroneCrossing,
  getCompetitiveAction,
  getTrapAction,
} from "./engine/world/bot-helpers.ts";
export { getHazardMap } from "./engine/world/hazard-map.ts";
export { DEFAULT_WORLD_RULES, CLASSIC_WORLD_RULES } from "./engine/world/types.ts";
export type {
  WorldState,
  WorldRules,
  CargoTrap,
  ScavengerDrone,
  GuardianCache,
  NaturalHazard,
  HazardKind,
  BotDefense,
} from "./engine/world/types.ts";
