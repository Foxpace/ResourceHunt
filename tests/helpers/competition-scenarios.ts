import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { canCapture, canSteal, findPath, samePosition, terrainCost } from "../../src/sdk.ts";
import {
  DEFAULT_CONFIG,
  type Action,
  type Observation,
  type Position,
  type Snapshot,
  type GameConfig,
} from "../../src/engine/types.ts";
import {
  advanceGame,
  advanceUntil,
  createBotController,
  createGame,
  createObservationFromSnapshot,
  moveToward,
} from "./game-fixtures.ts";
import { openingPosition } from "./map-assertions.ts";

export class CaptureScenario {
  mode: "capture" | "skip" = "capture";
  readonly game;

  constructor(context: TestContext) {
    const bot = createBotController("a", (state) => this.decide(state));
    this.game = createGame(context, {
      bots: [bot],
      config: { seed: "capture-reset", ticks: 100, resourceDensity: 0, outpostCount: 1 },
    });
  }

  private decide(state: Observation): Action {
    const outpost = state.outposts[0]!;
    if (!samePosition(state.self.position, outpost)) return moveToward(state, outpost);

    const capturing = this.mode === "capture";
    const unowned = outpost.ownerId !== "a";
    if (capturing && unowned) assert.ok(canCapture(state));

    return { type: this.mode };
  }
}

export async function createCapturingGame(context: TestContext) {
  const scenario = new CaptureScenario(context);
  await advanceUntil(scenario.game, (snapshot) => snapshot.outposts[0]!.captureProgress === 1);

  return scenario;
}

export class ContestedOutpostScenario {
  phase: "gather" | "contest" | "claim" | "reclaim" = "gather";
  readonly game;
  private loaded = new Set<string>();
  private target: Position;
  private awayFromOutpost: Position[];

  constructor(context: TestContext, config: Partial<GameConfig> = {}) {
    const bots = ["a", "b"].map((id) => createBotController(id, (state) => this.decide(state)));
    this.game = createGame(context, {
      bots,
      config: { seed: "reclaim", ticks: 250, outpostCount: 1, hotspotCount: 0, ...config },
    });
    const snapshot = this.game.snapshot();
    this.target = snapshot.outposts[0]!;
    this.awayFromOutpost = outpostExits(snapshot, this.target);
  }

  private decide(state: Observation): Action {
    const collection = this.collectOpeningResources(state);
    if (collection) return collection;

    const goal = this.chooseGoal(state.self.id);
    if (!samePosition(state.self.position, goal)) return moveCargoToward(state, goal);

    const firstCapturing =
      state.self.id === "a" && (this.phase === "contest" || this.phase === "claim");
    const secondReclaiming = state.self.id === "b" && this.phase === "reclaim";

    return { type: firstCapturing || secondReclaiming ? "capture" : "skip" };
  }

  private collectOpeningResources(state: Observation): Action | undefined {
    if (this.loaded.has(state.self.id)) return;
    if (state.self.inventory.length >= 2) {
      this.loaded.add(state.self.id);

      return;
    }
    const opening = openingPosition(state.map, state.self.base);

    return samePosition(state.self.position, opening)
      ? { type: "grab" }
      : moveToward(state, opening);
  }

  private chooseGoal(id: string): Position {
    const secondLeaving = this.phase === "claim" && id === "b";
    const firstLeaving = this.phase === "reclaim" && id === "a";
    if (secondLeaving) return this.awayFromOutpost[0]!;
    if (firstLeaving) return this.awayFromOutpost[1]!;

    return this.target;
  }

  async gather(): Promise<void> {
    await advanceUntil(this.game, (snapshot) =>
      snapshot.bots.every((bot) => samePosition(bot.position, this.target)),
    );
  }

  async contest(): Promise<void> {
    this.phase = "contest";
    await advanceGame(this.game, 2);
  }

  async claimFor(id: "a" | "b"): Promise<void> {
    this.phase = id === "a" ? "claim" : "reclaim";
    await advanceUntil(this.game, (snapshot) => snapshot.outposts[0]!.ownerId === id);
  }

  observe(id: string): Observation {
    return createObservationFromSnapshot(this.game.snapshot(), id);
  }
}

function outpostExits(snapshot: Snapshot, outpost: Position): Position[] {
  return [
    { x: outpost.x + 1, y: outpost.y },
    { x: outpost.x - 1, y: outpost.y },
    { x: outpost.x, y: outpost.y - 1 },
    { x: outpost.x, y: outpost.y + 1 },
  ].filter((position) => Number.isFinite(terrainCost(snapshot.map, position)));
}

function moveCargoToward(state: Observation, target: Position): Action {
  const map = structuredClone(state.map);
  const carrying = state.self.inventory.length > 0;
  const awayFromHome = !samePosition(target, state.self.base);
  if (carrying && awayFromHome) map.tiles[state.self.base.y]![state.self.base.x] = "water";

  const direction = findPath(map, state.self.position, target)?.steps[0];

  return direction ? { type: "move", direction } : { type: "skip" };
}

export async function createContestedOutpost(
  context: TestContext,
  config: Partial<GameConfig> = {},
) {
  const scenario = new ContestedOutpostScenario(context, config);
  await scenario.gather();

  return scenario;
}

export class TheftScenario {
  returnHome = false;
  readonly stealTicks: number[] = [];
  readonly game;
  private target?: Position;

  constructor(context: TestContext) {
    const victim = createBotController("victim", (state) => this.decideVictim(state));
    const thief = createBotController("thief", (state) => this.decideThief(state));
    this.game = createGame(context, {
      bots: [victim, thief],
      config: { seed: "theft-cooldown", ticks: 200, hotspotCount: 0, outpostCount: 0 },
    });
  }

  private decideVictim(state: Observation): Action {
    this.target = { x: state.self.base.x, y: state.self.base.y + 1 };
    if (!samePosition(state.self.position, this.target)) return moveToward(state, this.target);
    if (state.resources.some((pile) => samePosition(pile, this.target!))) return { type: "grab" };

    return { type: "skip" };
  }

  private decideThief(state: Observation): Action {
    if (this.returnHome) return { type: "home" };
    if (!samePosition(state.self.position, this.target!)) return moveToward(state, this.target!);
    if (canSteal(state, "victim")) this.stealTicks.push(state.tick);

    return { type: "steal", targetId: "victim" };
  }

  async stealUnits(count: number): Promise<void> {
    await advanceUntil(this.game, (snapshot) => snapshot.bots[1]!.stolen === count);
  }

  observe(id: string): Observation {
    return createObservationFromSnapshot(this.game.snapshot(), id);
  }
}

export function createSafeBaseGame(context: TestContext) {
  let loaded = false;
  const victim = createBotController("victim", (state) => {
    if (state.self.inventory.length >= 2) loaded = true;

    const opening = { x: state.self.base.x, y: state.self.base.y + 1 };
    if (loaded) return moveToward(state, state.bots[1]!.base);

    return samePosition(state.self.position, opening)
      ? { type: "grab" }
      : moveToward(state, opening);
  });
  const thief = createBotController("thief", () => ({ type: "steal", targetId: "victim" }));
  const game = createGame(context, {
    bots: [victim, thief],
    config: { seed: "safe-base", ticks: 150, hotspotCount: 0, outpostCount: 0 },
  });

  return game;
}

export function createTheftObservation(context: TestContext): Observation {
  const bots = ["a", "b"].map((id) => createBotController(id, () => ({ type: "skip" })));
  const game = createGame(context, { bots, config: DEFAULT_CONFIG });
  const snapshot = game.snapshot();
  const position = { x: snapshot.bots[0]!.base.x, y: snapshot.bots[0]!.base.y + 1 };
  for (const bot of snapshot.bots) bot.position = { ...position };

  snapshot.bots[0]!.inventory = ["relic", "relic"];
  snapshot.bots[1]!.inventory = ["ore", "crystal", "relic"];

  return createObservationFromSnapshot(snapshot, "a");
}

export function createOwnedBankTrip(context: TestContext) {
  const game = createGame(context, { config: DEFAULT_CONFIG });
  const state = createObservationFromSnapshot(game.snapshot(), "test");
  const outpost = state.outposts[0]!;
  outpost.ownerId = "test";
  const pile = state.resources.find(
    (resource) =>
      findPath(state.map, resource, outpost)!.cost <
      findPath(state.map, resource, state.self.base)!.cost,
  );
  assert.ok(pile);

  return { state, outpost, pile };
}
