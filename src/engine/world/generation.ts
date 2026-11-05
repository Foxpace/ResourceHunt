import { StrategicSitePlanner } from "../maps/strategic-site-planner.ts";
import { createEmptyWorld, type WorldContext, type WorldState } from "./types.ts";

export function createWorldState(context: WorldContext): WorldState {
  const state = createEmptyWorld();
  const guardedHotspots = context.hotspots.slice(0, context.config.guardianCount);
  state.caches = guardedHotspots.map(({ x, y }, index) => ({
    id: `cache-${index + 1}`,
    position: { x, y },
    guardianHealth: 3,
    guardianPosition: { x, y },
    nextGuardianMoveTick: 0,
    inventory: ["relic", "relic", "crystal", "crystal"],
    nextAttackTick: 0,
  }));
  const dronePositions = placeNeutralSites(context, context.config.scavengerCount);
  state.drones = dronePositions.map((position, index) => ({
    id: `drone-${index + 1}`,
    position,
    health: 2,
    inventory: [],
    route: [],
    nextMoveTick: 6,
  }));
  state.defenses = context.bots.map((bot) => ({
    botId: bot.id,
    guardedUntilTick: 0,
    toolsReadyTick: 0,
  }));

  return state;
}

function placeNeutralSites(context: WorldContext, count: number) {
  if (!count) return [];

  const { map, config, bots, outposts, hotspots } = context;
  const bases = bots.map((bot) => bot.base);
  const planner = new StrategicSitePlanner(
    { map, config: { ...config, seed: `${config.seed}:neutral` } },
    { bases, protectedCells: [...bases, ...outposts, ...hotspots] },
  );

  return planner.placeHotspots(count);
}
