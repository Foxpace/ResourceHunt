import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canGrab,
  findPath,
  getInventoryStats,
  getMoveOptions,
  getOpponentArrivalTimes,
  planTrip,
  samePosition,
  type Action,
  type BotState,
  type GameMap,
  type Observation,
  type OpponentArrivalTime,
  type Position,
  type TripPlan,
} from "../src/sdk.ts";
import { DEFAULT_CONFIG, type BotController } from "../src/engine/types.ts";
import { Game } from "../src/engine/game.ts";

function bot(id: string, position: Position, base = position): BotState {
  return {
    id,
    name: id,
    description: "SDK test",
    color: "#ffffff",
    position,
    base,
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
  };
}

function state(map: GameMap, bots = [bot("self", { x: 0, y: 0 })]): Observation {
  return {
    config: { ...DEFAULT_CONFIG, width: map.width, height: map.height, ticks: 50 },
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
  };
}

test("move options expose terrain costs, river blocking, and map bounds without changing state", () => {
  const observation = state(
    {
      width: 3,
      height: 3,
      tiles: [
        ["grass", "forest", "grass"],
        ["bridge", "grass", "water"],
        ["grass", "mountain", "grass"],
      ],
    },
    [bot("self", { x: 1, y: 1 })],
  );
  const before = structuredClone(observation);
  assert.deepStrictEqual(getMoveOptions(observation), [
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
  ]);
  assert.deepStrictEqual(observation, before);
  observation.self.position = { x: 0, y: 0 };
  const moves = getMoveOptions(observation);
  assert.ok(
    moves
      .filter((move) => move.terrain === null)
      .every((move) => !move.passable && move.cost === Infinity),
  );
  assert.strictEqual(moves.filter((move) => move.terrain === null).length, 2);
});

test("inventory stats distinguish unit count, weight, and carried value", () => {
  const observation = state({ width: 1, height: 1, tiles: [["grass"]] });
  assert.deepStrictEqual(getInventoryStats(observation), {
    units: 0,
    weight: 0,
    capacity: 8,
    freeWeight: 8,
    carriedValue: 0,
  });
  observation.self.inventory = ["ore", "crystal", "relic"];
  assert.deepStrictEqual(getInventoryStats(observation), {
    units: 3,
    weight: 6,
    capacity: 8,
    freeWeight: 2,
    carriedValue: 23,
  });
});

test("canGrab requires a present unit, enough capacity, and an available turn", () => {
  const observation = state({ width: 2, height: 1, tiles: [["grass", "grass"]] });
  observation.resources = [{ x: 0, y: 0, kind: "crystal", amount: 2 }];
  observation.self.inventory = ["relic", "relic"];
  assert.strictEqual(canGrab(observation), true);
  observation.self.inventory.push("ore");
  assert.strictEqual(canGrab(observation), false);
  observation.self.inventory = [];
  observation.resources[0]!.amount = 0;
  assert.strictEqual(canGrab(observation), false);
  observation.resources[0]!.amount = 2;
  observation.self.travelRemaining = 1;
  assert.strictEqual(canGrab(observation), false);
  observation.self.travelRemaining = 0;
  observation.self.disabled = true;
  assert.strictEqual(canGrab(observation), false);
  observation.self.disabled = false;
  observation.remainingTicks = 0;
  assert.strictEqual(canGrab(observation), false);
  observation.remainingTicks = 10;
  observation.self.position = { x: 1, y: 0 };
  assert.strictEqual(canGrab(observation), false);
  observation.resources = [];
  assert.strictEqual(canGrab(observation), false);
});

test("trip plans account for weighted travel, pickups, and the exact banking deadline", () => {
  const observation = state({ width: 3, height: 1, tiles: [["grass", "forest", "mountain"]] });
  const pile = { x: 2, y: 0, kind: "relic", amount: 3 } as const;
  observation.resources = [pile];
  observation.remainingTicks = 10;
  const before = structuredClone(observation);
  const plan = planTrip(observation, pile, 2);
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
  assert.deepStrictEqual(observation, before);
  observation.remainingTicks = 9;
  assert.deepStrictEqual(planTrip(observation, pile, 2).reasons, ["deadline"]);
  observation.remainingTicks = 50;
  observation.self.base = { x: 1, y: 0 };
  observation.self.inventory = ["relic"];
  // Crossing home unloads the existing bag before collecting the next load.
  assert.strictEqual(planTrip(observation, pile, 2).feasible, true);
  observation.self.base = { x: 0, y: 0 };
  assert.ok(planTrip(observation, pile, 2).reasons.includes("capacity"));
});

test("trip plans check the live pile, unreachable targets, fatigue, and invalid unit counts", () => {
  const observation = state({ width: 3, height: 1, tiles: [["grass", "water", "grass"]] });
  const pile = { x: 2, y: 0, kind: "crystal", amount: 99 } as const;
  observation.resources = [{ ...pile, amount: 1 }];
  const plan = planTrip(observation, pile, 2);
  assert.ok(plan.reasons.includes("unreachable"));
  assert.ok(plan.reasons.includes("insufficient-resources"));
  assert.strictEqual(plan.totalTurns, Infinity);
  observation.resources = [];
  assert.ok(planTrip(observation, pile).reasons.includes("missing-resource"));
  for (const units of [0, -1, 1.5, NaN, Infinity])
    assert.throws(() => planTrip(observation, pile, units), RangeError);
  observation.map.tiles[0]![1] = "grass";
  observation.self.position = { x: 2, y: 0 };
  observation.self.travelRemaining = 2;
  observation.resources = [{ ...pile, amount: 1 }];
  assert.strictEqual(planTrip(observation, pile).totalTurns, 5);
  observation.self.disabled = true;
  assert.ok(planTrip(observation, pile).reasons.includes("disabled"));
});

test("opponent arrival estimates include already-acted turns, terrain delays, and rotating initiative", () => {
  const earlier = bot("earlier", { x: 1, y: 0 });
  earlier.travelRemaining = 1;
  const self = bot("self", { x: 3, y: 0 });
  const later = bot("later", { x: 0, y: 0 });
  const observation = state(
    { width: 4, height: 1, tiles: [["grass", "forest", "mountain", "grass"]] },
    [earlier, self, later],
  );
  const estimates = getOpponentArrivalTimes(observation, { x: 2, y: 0 });
  assert.deepStrictEqual(
    estimates.map(({ botId, arrivalTick, readyTick, turnOrder }) => ({
      botId,
      arrivalTick,
      readyTick,
      turnOrder,
    })),
    [
      { botId: "later", arrivalTick: 2, readyTick: 5, turnOrder: 0 },
      { botId: "earlier", arrivalTick: 2, readyTick: 5, turnOrder: 1 },
    ],
  );
  observation.tick = 1;
  const nextRound = getOpponentArrivalTimes(observation, { x: 2, y: 0 });
  assert.strictEqual(nextRound.find((estimate) => estimate.botId === "earlier")!.readyTick, 5);
  assert.strictEqual(nextRound.find((estimate) => estimate.botId === "later")!.readyTick, 6);
});

test("opponents already at a target can act only after their remaining delay and turn", () => {
  const earlier = bot("earlier", { x: 0, y: 0 });
  const self = bot("self", { x: 1, y: 0 });
  const later = bot("later", { x: 0, y: 0 });
  later.travelRemaining = 2;
  const disabled = bot("disabled", { x: 0, y: 0 });
  disabled.disabled = true;
  const observation = state({ width: 3, height: 1, tiles: [["grass", "grass", "water"]] }, [
    earlier,
    self,
    later,
    disabled,
  ]);
  const estimates = getOpponentArrivalTimes(observation, { x: 0, y: 0 });
  assert.partialDeepStrictEqual(estimates, [
    { botId: "earlier", arrivalTick: 0, readyTick: 1 },
    { botId: "later", arrivalTick: 0, readyTick: 2 },
    { botId: "disabled", arrivalTick: Infinity, readyTick: Infinity, turnOrder: Infinity },
  ]);
  assert.ok(
    getOpponentArrivalTimes(observation, { x: 2, y: 0 }).every(
      (estimate) => estimate.route === null && estimate.readyTick === Infinity,
    ),
  );
});

test("a planned resource trip banks its predicted value on its predicted engine tick", async () => {
  let plan: TripPlan;
  let grabs = 0;
  let outwardIndex = 0;
  let returnIndex = 0;
  const controller: BotController = {
    metadata: { id: "trip", name: "Trip", description: "Follows an SDK trip plan" },
    async decide(observation) {
      if (!plan) {
        const pile = observation.resources.find(
          (pile) => observation.map.tiles[pile.y]![pile.x] === "mountain" && pile.amount >= 2,
        )!;
        assert.ok(pile);
        plan = planTrip(observation, pile, 2);
        assert.ok(plan.feasible);
      }
      let action: Action;
      const outward = plan.outbound!.steps[outwardIndex];
      const homeward = plan.homeward!.steps[returnIndex];
      if (outward) {
        outwardIndex++;
        action = { type: "move", direction: outward };
      } else if (grabs < plan.units) {
        assert.ok(canGrab(observation));
        grabs++;
        action = { type: "grab" };
      } else if (homeward) {
        returnIndex++;
        action = { type: "move", direction: homeward };
      } else action = { type: "skip" };
      return { action };
    },
    dispose() {},
  };
  const game = new Game([controller], { seed: "sdk-trip", ticks: 300 });
  try {
    do {
      await game.step();
    } while (!game.result().standings[0]!.score && game.result().ticks < 300);
    assert.strictEqual(game.result().ticks, plan!.totalTurns);
    assert.strictEqual(game.result().standings[0]!.score, plan!.bankedValue);
    assert.strictEqual(game.result().standings[0]!.errors, 0);
  } finally {
    game.dispose();
  }
});

test("opponent estimates match actual arrival and next-decision ticks in the engine", async () => {
  let target: Position;
  let estimates: OpponentArrivalTime[];
  const arrivals = new Map<string, number>();
  const ready = new Map<string, number>();
  const controllers = ["earlier", "observer", "later"].map((id): BotController => ({
    metadata: { id, name: id, description: "Arrival test" },
    async decide(observation) {
      target ??= observation.resources.find(
        (pile) => observation.map.tiles[pile.y]![pile.x] === "mountain",
      )!;
      assert.ok(target);
      if (id === "observer") {
        estimates ??= getOpponentArrivalTimes(observation, target);
        return { action: { type: "skip" } };
      }
      if (samePosition(observation.self.position, target)) {
        if (!ready.has(id)) ready.set(id, observation.tick);
        return { action: { type: "skip" } };
      }
      const direction = findPath(observation.map, observation.self.position, target)!.steps[0]!;
      return { action: { type: "move", direction } };
    },
    dispose() {},
  }));
  const game = new Game(controllers, { seed: "sdk-arrival", ticks: 200 });
  try {
    while (ready.size < 2 && game.result().ticks < 200) {
      const snapshot = await game.step();
      for (const bot of snapshot.bots) {
        if (bot.id !== "observer" && samePosition(bot.position, target!) && !arrivals.has(bot.id))
          arrivals.set(bot.id, snapshot.tick - 1);
      }
    }
    for (const estimate of estimates!) {
      assert.strictEqual(arrivals.get(estimate.botId), estimate.arrivalTick);
      assert.strictEqual(ready.get(estimate.botId), estimate.readyTick);
    }
  } finally {
    game.dispose();
  }
});
