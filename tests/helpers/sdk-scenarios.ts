import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import {
  canGrab,
  getOpponentArrivalTimes,
  planTrip,
  samePosition,
  type OpponentArrivalTime,
  type TripPlan,
} from "../../src/sdk.ts";
import {
  DEFAULT_CONFIG,
  type Action,
  type BotState,
  type Observation,
  type Position,
  type Snapshot,
} from "../../src/engine/types.ts";
import { createMap, createBotState, createObservation } from "./sdk-fixtures.ts";
import { createBotController, createGame, moveToward } from "./game-fixtures.ts";

export function createMovementObservation() {
  return createObservation({
    map: createMap([
      ["grass", "forest", "grass"],
      ["bridge", "grass", "water"],
      ["grass", "mountain", "grass"],
    ]),
    self: createBotState({ position: { x: 1, y: 1 } }),
  });
}

export function createGrabObservation(
  options: { self?: Partial<BotState>; amount?: number; remainingTicks?: number } = {},
) {
  return createObservation({
    map: createMap([["grass", "grass"]]),
    self: createBotState({ inventory: ["relic", "relic"], ...options.self }),
    resources: [{ x: 0, y: 0, kind: "crystal", amount: options.amount ?? 2 }],
    remainingTicks: options.remainingTicks ?? 50,
  });
}

export function createWeightedTripObservation() {
  const pile = { x: 2, y: 0, kind: "relic", amount: 3 } as const;
  const observation = createObservation({
    map: createMap([["grass", "forest", "mountain"]]),
    resources: [pile],
    remainingTicks: 10,
  });

  return { observation, pile };
}

export function assertWeightedTrip(plan: TripPlan): void {
  assert.partialDeepStrictEqual(plan, {
    units: 2,
    outbound: { cost: 5, steps: ["E", "E"] },
    homeward: { cost: 3, steps: ["W", "W"] },
    travelTurns: 8,
    grabTurns: 2,
    totalTurns: 10,
    resourceValue: 28,
    bankedValue: 28,
    feasible: true,
    reasons: [],
  });
}

export function createOpponentObservation(atTarget = false) {
  const earlier = createBotState({
    id: "earlier",
    position: { x: atTarget ? 0 : 1, y: 0 },
    travelRemaining: atTarget ? 0 : 1,
  });
  const self = createBotState({ position: { x: atTarget ? 1 : 3, y: 0 } });
  const later = createBotState({ id: "later", travelRemaining: atTarget ? 2 : 0 });
  const bots = [earlier, self, later];
  if (atTarget) bots.push(createBotState({ id: "disabled", disabled: true }));

  return createObservation({
    map: createMap([
      atTarget ? ["grass", "grass", "water"] : ["grass", "forest", "mountain", "grass"],
    ]),
    bots,
  });
}

class PlannedTrip {
  plan?: TripPlan;
  private actions: Action[] = [];
  private nextAction = 0;

  decide(state: Observation): Action {
    if (!this.plan) this.planResourceTrip(state);

    const action = this.actions[this.nextAction++] ?? { type: "skip" };
    if (action.type === "grab") assert.ok(canGrab(state));

    return action;
  }

  private planResourceTrip(state: Observation): void {
    const pile = state.resources.find((resource) => {
      const onMountain = state.map.tiles[resource.y]![resource.x] === "mountain";
      const enoughResources = resource.amount >= 2;

      return onMountain && enoughResources;
    });
    assert.ok(pile);
    this.plan = planTrip(state, pile, 2);
    assert.ok(this.plan.feasible);
    const outbound = this.plan.outbound!.steps.map(
      (direction): Action => ({
        type: "move",
        direction,
      }),
    );
    const homeward = this.plan.homeward!.steps.map(
      (direction): Action => ({
        type: "move",
        direction,
      }),
    );
    this.actions = [
      ...outbound,
      ...Array<Action>(this.plan.units).fill({ type: "grab" }),
      ...homeward,
    ];
  }
}

export function createPlannedTrip(context: TestContext) {
  const trip = new PlannedTrip();
  const bot = createBotController("trip", (state) => trip.decide(state));
  const game = createGame(context, {
    bots: [bot],
    config: { ...DEFAULT_CONFIG, seed: "sdk-trip", ticks: 300 },
  });

  return { game, trip };
}

class ArrivalRace {
  target?: Position;
  estimates?: OpponentArrivalTime[];
  readonly arrivals = new Map<string, number>();
  readonly ready = new Map<string, number>();

  decide(id: string, state: Observation): Action {
    this.target ??= state.resources.find((pile) => state.map.tiles[pile.y]![pile.x] === "mountain");
    assert.ok(this.target);
    if (id === "observer") {
      this.estimates ??= getOpponentArrivalTimes(state, this.target);

      return { type: "skip" };
    }
    if (samePosition(state.self.position, this.target)) {
      if (!this.ready.has(id)) this.ready.set(id, state.tick);

      return { type: "skip" };
    }

    return moveToward(state, this.target);
  }

  recordArrivals(snapshot: Snapshot): void {
    for (const bot of snapshot.bots) {
      const opponent = bot.id !== "observer";
      const arrived = !!this.target && samePosition(bot.position, this.target);
      const unrecorded = !this.arrivals.has(bot.id);
      if (opponent && arrived && unrecorded) this.arrivals.set(bot.id, snapshot.tick - 1);
    }
  }
}

export function createArrivalRace(context: TestContext) {
  const race = new ArrivalRace();
  const bots = ["earlier", "observer", "later"].map((id) =>
    createBotController(id, (state) => race.decide(id, state)),
  );
  const game = createGame(context, {
    bots,
    config: { ...DEFAULT_CONFIG, seed: "sdk-arrival", ticks: 200 },
  });

  return { game, race };
}

export function assertOpponentTurnOrder(estimates: OpponentArrivalTime[]): void {
  const timing = estimates.map(({ botId, arrivalTick, readyTick, turnOrder }) => ({
    botId,
    arrivalTick,
    readyTick,
    turnOrder,
  }));
  assert.deepEqual(timing, [
    { botId: "later", arrivalTick: 2, readyTick: 5, turnOrder: 0 },
    { botId: "earlier", arrivalTick: 2, readyTick: 5, turnOrder: 1 },
  ]);
}
