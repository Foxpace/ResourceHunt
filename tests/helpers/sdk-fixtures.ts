import { createEmptyWorld } from "../../src/engine/world/types.ts";
import { DEFAULT_CONFIG } from "../../src/engine/types.ts";
import type { BotState, GameMap, Observation, Terrain } from "../../src/sdk.ts";

export function createMap(tiles: Terrain[][]): GameMap {
  return { width: tiles[0]!.length, height: tiles.length, tiles };
}

export function createBotState(overrides: Partial<BotState> = {}): BotState {
  const id = overrides.id ?? "self";
  const position = overrides.position ?? { x: 0, y: 0 };

  return {
    id,
    name: id,
    description: "Test bot",
    color: "#ffffff",
    position,
    base: position,
    inventory: [],
    score: 0,
    delivered: 0,
    travelRemaining: 0,
    errors: 0,
    lastAction: "Ready",
    disabled: false,
    stealReadyTick: 0,
    theftProtectedUntilTick: 0,
    captures: 0,
    stolen: 0,
    lost: 0,
    ...overrides,
  };
}

export function createObservation(overrides: Partial<Observation> = {}): Observation {
  const map = overrides.map ?? createMap([["grass"]]);
  const bots = overrides.bots ?? [overrides.self ?? createBotState()];

  return {
    config: { ...DEFAULT_CONFIG, width: map.width, height: map.height, ticks: 50 },
    world: createEmptyWorld(),
    tick: 0,
    maxTicks: 50,
    remainingTicks: 50,
    capacity: 8,
    map,
    resources: [],
    hotspots: [],
    outposts: [],
    bots,
    self: bots.find((bot) => bot.id === "self") ?? bots[0]!,
    ...overrides,
  };
}
