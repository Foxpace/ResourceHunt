import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canGrab,
  getInventoryStats,
  getMoveOptions,
  getOpponentArrivalTimes,
  planTrip,
} from "../src/sdk.ts";
import { createMap, createBotState, createObservation } from "./helpers/sdk-fixtures.ts";
import {
  assertWeightedTrip,
  assertOpponentTurnOrder,
  createMovementObservation,
  createGrabObservation,
  createWeightedTripObservation,
  createOpponentObservation,
  createPlannedTrip,
  createArrivalRace,
} from "./helpers/sdk-scenarios.ts";
import { advanceUntil } from "./helpers/game-fixtures.ts";

for (const expected of [
  { direction: "N", destination: { x: 1, y: 0 }, terrain: "forest", cost: 2, passable: true },
  { direction: "W", destination: { x: 0, y: 1 }, terrain: "bridge", cost: 1, passable: true },
  {
    direction: "E",
    destination: { x: 2, y: 1 },
    terrain: "water",
    cost: Infinity,
    passable: false,
  },
  { direction: "S", destination: { x: 1, y: 2 }, terrain: "mountain", cost: 3, passable: true },
]) {
  test(`move options describe ${expected.terrain} to the ${expected.direction} without mutation`, () => {
    // Given
    const observation = createMovementObservation();
    const original = structuredClone(observation);

    // When
    const option = getMoveOptions(observation).find(
      (move) => move.direction === expected.direction,
    );

    // Then
    assert.deepEqual(option, expected);
    assert.deepEqual(observation, original);
  });
}

test("move options block destinations outside the map", () => {
  // Given
  const observation = createMovementObservation();
  observation.self.position = { x: 0, y: 0 };

  // When
  const outsideMoves = getMoveOptions(observation).filter((move) => move.terrain === null);

  // Then
  assert.equal(outsideMoves.length, 2);
  assert.ok(outsideMoves.every((move) => !move.passable));
  assert.ok(outsideMoves.every((move) => move.cost === Infinity));
});

for (const loaded of [false, true]) {
  test(`inventory stats distinguish units, weight, and value for ${loaded ? "loaded" : "empty"} bags`, () => {
    // Given
    const self = createBotState({ inventory: loaded ? ["ore", "crystal", "relic"] : [] });
    const observation = createObservation({ self });

    // When
    const stats = getInventoryStats(observation);

    // Then
    assert.deepEqual(
      stats,
      loaded
        ? { units: 3, weight: 6, capacity: 8, freeWeight: 2, carriedValue: 23 }
        : { units: 0, weight: 0, capacity: 8, freeWeight: 8, carriedValue: 0 },
    );
  });
}

const grabCases = [
  { name: "space for one crystal", options: {}, expected: true },
  {
    name: "a full bag",
    options: { self: { inventory: ["relic", "relic", "ore"] as ("relic" | "ore")[] } },
    expected: false,
  },
  { name: "an exhausted pile", options: { amount: 0 }, expected: false },
  { name: "remaining travel", options: { self: { travelRemaining: 1 } }, expected: false },
  { name: "a disabled bot", options: { self: { disabled: true } }, expected: false },
  { name: "a finished match", options: { remainingTicks: 0 }, expected: false },
  {
    name: "a pile at another position",
    options: { self: { position: { x: 1, y: 0 } } },
    expected: false,
  },
];
for (const scenario of grabCases) {
  test(`canGrab handles ${scenario.name}`, () => {
    // Given
    const observation = createGrabObservation(scenario.options);

    // When
    const allowed = canGrab(observation);

    // Then
    assert.equal(allowed, scenario.expected);
  });
}

test("canGrab rejects a missing resource pile", () => {
  // Given
  const observation = createGrabObservation();
  observation.resources = [];

  // When
  const allowed = canGrab(observation);

  // Then
  assert.equal(allowed, false);
});

test("trip planning includes weighted travel, pickups, and an exact banking deadline", () => {
  // Given
  const { observation, pile } = createWeightedTripObservation();
  const original = structuredClone(observation);

  // When
  const plan = planTrip(observation, pile, 2);

  // Then
  assertWeightedTrip(plan);
  assert.deepEqual(observation, original);
});

test("a trip arriving one turn after the deadline is rejected", () => {
  // Given
  const { observation, pile } = createWeightedTripObservation();
  observation.remainingTicks = 9;

  // When
  const plan = planTrip(observation, pile, 2);

  // Then
  assert.deepEqual(plan.reasons, ["deadline"]);
});

for (const crossesHome of [false, true]) {
  test(`trip capacity ${crossesHome ? "allows" : "rejects"} a load ${crossesHome ? "banked on the way" : "carried throughout"}`, () => {
    // Given
    const { observation, pile } = createWeightedTripObservation();
    observation.remainingTicks = 50;
    observation.self.inventory = ["relic"];
    observation.self.base = { x: crossesHome ? 1 : 0, y: 0 };

    // When
    const plan = planTrip(observation, pile, 2);

    // Then
    assert.equal(plan.feasible, crossesHome);
    assert.equal(plan.reasons.includes("capacity"), !crossesHome);
  });
}

test("trip planning checks the live pile amount and unreachable terrain", () => {
  // Given
  const pile = { x: 2, y: 0, kind: "crystal", amount: 99 } as const;
  const observation = createObservation({
    map: createMap([["grass", "water", "grass"]]),
    resources: [{ ...pile, amount: 1 }],
  });

  // When
  const plan = planTrip(observation, pile, 2);

  // Then
  assert.ok(plan.reasons.includes("unreachable"));
  assert.ok(plan.reasons.includes("insufficient-resources"));
  assert.equal(plan.totalTurns, Infinity);
});

test("trip planning rejects a missing pile", () => {
  // Given
  const { observation, pile } = createWeightedTripObservation();
  observation.resources = [];

  // When
  const plan = planTrip(observation, pile);

  // Then
  assert.ok(plan.reasons.includes("missing-resource"));
});

for (const units of [0, -1, 1.5, NaN, Infinity]) {
  test(`trip planning rejects an invalid unit count of ${units}`, () => {
    // Given
    const { observation, pile } = createWeightedTripObservation();

    // When
    const plan = () => planTrip(observation, pile, units);

    // Then
    assert.throws(plan, RangeError);
  });
}

test("trip duration includes fatigue before a pickup and return home", () => {
  // Given
  const pile = { x: 2, y: 0, kind: "crystal", amount: 1 } as const;
  const self = createBotState({ position: pile, base: { x: 0, y: 0 }, travelRemaining: 2 });
  const observation = createObservation({
    map: createMap([["grass", "grass", "grass"]]),
    self,
    resources: [pile],
  });

  // When
  const plan = planTrip(observation, pile);

  // Then
  assert.equal(plan.totalTurns, 5);
});

test("trip planning rejects disabled bots", () => {
  // Given
  const { observation, pile } = createWeightedTripObservation();
  observation.self.disabled = true;

  // When
  const plan = planTrip(observation, pile);

  // Then
  assert.ok(plan.reasons.includes("disabled"));
});

for (const tick of [0, 1]) {
  test(`opponent arrival estimates account for terrain and initiative on tick ${tick}`, () => {
    // Given
    const observation = createOpponentObservation();
    observation.tick = tick;

    // When
    const estimates = getOpponentArrivalTimes(observation, { x: 2, y: 0 });

    // Then
    assert.equal(estimates.find((estimate) => estimate.botId === "earlier")!.readyTick, 5);
    assert.equal(
      estimates.find((estimate) => estimate.botId === "later")!.readyTick,
      tick === 0 ? 5 : 6,
    );
  });
}

test("opponents already at the target wait for fatigue and their next turn", () => {
  // Given
  const observation = createOpponentObservation(true);

  // When
  const estimates = getOpponentArrivalTimes(observation, { x: 0, y: 0 });

  // Then
  assert.partialDeepStrictEqual(estimates, [
    { botId: "earlier", arrivalTick: 0, readyTick: 1 },
    { botId: "later", arrivalTick: 0, readyTick: 2 },
    { botId: "disabled", arrivalTick: Infinity, readyTick: Infinity, turnOrder: Infinity },
  ]);
});

test("opponents cannot reach blocked targets", () => {
  // Given
  const observation = createOpponentObservation(true);

  // When
  const estimates = getOpponentArrivalTimes(observation, { x: 2, y: 0 });

  // Then
  assert.ok(estimates.every((estimate) => estimate.route === null));
  assert.ok(estimates.every((estimate) => estimate.readyTick === Infinity));
});

test("a planned resource trip banks its predicted value on its predicted tick", async (context) => {
  // Given
  const { game, trip } = createPlannedTrip(context);

  // When
  await advanceUntil(game, (snapshot) => snapshot.bots[0]!.score > 0);

  // Then
  assert.equal(game.result().ticks, trip.plan!.totalTurns);
  assert.equal(game.result().standings[0]!.score, trip.plan!.bankedValue);
  assert.equal(game.result().standings[0]!.errors, 0);
});

test("opponent estimates match engine arrival and next-decision ticks", async (context) => {
  // Given
  const { game, race } = createArrivalRace(context);

  // When
  while (race.ready.size < 2) {
    const tickLimitReached = game.result().ticks >= 200;
    if (tickLimitReached) break;

    race.recordArrivals(await game.step());
  }

  // Then
  for (const estimate of race.estimates!) {
    assert.equal(race.arrivals.get(estimate.botId), estimate.arrivalTick);
    assert.equal(race.ready.get(estimate.botId), estimate.readyTick);
  }
});

test("opponent initiative resolves equal arrival times in rotating turn order", () => {
  // Given
  const observation = createOpponentObservation();

  // When
  const estimates = getOpponentArrivalTimes(observation, { x: 2, y: 0 });

  // Then
  assertOpponentTurnOrder(estimates);
});
