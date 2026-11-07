import { normalizeConfig } from "../../src/engine/config.ts";
import { WorldController } from "../../src/engine/world/world-controller.ts";
import {
  CLASSIC_WORLD_RULES,
  type GuardianCache,
  type CargoTrap,
  type NaturalHazard,
  type ScavengerDrone,
  type WorldContext,
} from "../../src/engine/world/types.ts";
import type { Action, GameConfig, Observation, Position } from "../../src/engine/types.ts";
import { createBotState, createMap } from "./sdk-fixtures.ts";

export class WorldScenario {
  readonly context: WorldContext;
  readonly controller: WorldController;

  constructor(config: Partial<GameConfig> = {}) {
    this.context = createWorldContext(config);
    this.controller = new WorldController(this.context);
  }

  get state() {
    return this.controller.state;
  }
  get attacker() {
    return this.context.bots[0]!;
  }
  get defender() {
    return this.context.bots[1]!;
  }
  get depot() {
    return this.context.outposts[0]!;
  }

  act(action: Action, botId = "attacker"): void {
    const bot = this.context.bots.find((candidate) => candidate.id === botId)!;
    this.controller.applyAction(this.context, { bot, action });
  }

  advanceTo(tick: number): void {
    this.context.tick = tick;
    this.controller.prepareTick(this.context);
  }

  moveDefender(position: Position): void {
    this.defender.position = position;
    this.controller.afterMovement(this.context, this.defender);
  }

  observe(botId = "attacker"): Observation {
    return {
      ...this.context,
      world: this.state,
      maxTicks: 100,
      remainingTicks: 100 - this.context.tick,
      capacity: 8,
      self: this.context.bots.find((bot) => bot.id === botId)!,
    };
  }
}

export function createDrone(overrides: Partial<ScavengerDrone> = {}): ScavengerDrone {
  return {
    id: "drone-1",
    position: { x: 6, y: 6 },
    health: 2,
    inventory: [],
    route: [],
    nextMoveTick: 10,
    ...overrides,
  };
}

export function createCache(overrides: Partial<GuardianCache> = {}): GuardianCache {
  return {
    id: "cache-1",
    position: { x: 6, y: 6 },
    guardianHealth: 3,
    inventory: ["relic", "relic", "crystal", "crystal"],
    nextAttackTick: 99,
    ...overrides,
  };
}

export function createHazard(overrides: Partial<NaturalHazard> = {}): NaturalHazard {
  return {
    id: "hazard-1",
    kind: "lava",
    center: { x: 5, y: 6 },
    cells: [{ x: 5, y: 6 }],
    announcedAt: 10,
    startsAt: 11,
    endsAt: 18,
    ...overrides,
  };
}

export function armTrap(scenario: WorldScenario): void {
  scenario.act({ type: "deployTrap" });
  scenario.advanceTo(11);
}

export function disableDepot(scenario: WorldScenario): void {
  scenario.act({ type: "sabotage", targetId: "outpost-1" });
}

function createWorldBots() {
  const attacker = createBotState({
    id: "attacker",
    base: { x: 1, y: 1 },
    position: { x: 5, y: 6 },
    inventory: ["ore", "crystal"],
  });
  const defender = createBotState({
    id: "defender",
    base: { x: 11, y: 11 },
    position: { x: 7, y: 6 },
    inventory: ["relic", "crystal"],
  });

  return [attacker, defender];
}

function createWorldContext(config: Partial<GameConfig>): WorldContext {
  return {
    tick: 10,
    config: normalizeConfig({
      ...CLASSIC_WORLD_RULES,
      sabotage: true,
      cargoTraps: true,
      ticks: 100,
      width: 13,
      height: 13,
      ...config,
    }),
    map: createMap(Array.from({ length: 13 }, () => Array(13).fill("grass"))),
    bots: createWorldBots(),
    resources: [],
    hotspots: [],
    events: [],
    outposts: [
      {
        id: "outpost-1",
        x: 6,
        y: 6,
        ownerId: "defender",
        capturingBotId: null,
        captureProgress: 0,
      },
    ],
  };
}

export function createTrap(overrides: Partial<CargoTrap> = {}): CargoTrap {
  return { id: "trap-1", ownerId: "attacker", x: 8, y: 5, armedAt: 1, expiresAt: 30, ...overrides };
}
