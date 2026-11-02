import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine/game.ts";
import { generateMap, normalizeConfig, parseReplay } from "../src/index.ts";
import { configFromFlags, parseArguments } from "../src/cli/options.ts";
import {
  canCapture,
  canSteal,
  distanceField,
  findPath,
  getBankingSites,
  getNearestBank,
  getStealTargets,
  planTrip,
  positionKey,
  samePosition,
  terrainCost,
  type Action,
  type Observation,
  type Position,
} from "../src/sdk.ts";
import type { BotController, Snapshot } from "../src/engine/types.ts";

function controller(id: string, action: (state: Observation) => Action): BotController {
  return {
    metadata: { id, name: id, description: "Competition test" },
    async decide(state) {
      return { action: action(state) };
    },
    dispose() {},
  };
}
function toward(state: Observation, target: Position): Action {
  const direction = findPath(state.map, state.self.position, target)?.steps[0];
  return direction ? { type: "move", direction } : { type: "skip" };
}
function observation(snapshot: Snapshot, id: string): Observation {
  return {
    ...snapshot,
    self: snapshot.bots.find((bot) => bot.id === id)!,
    maxTicks: snapshot.config.ticks,
    remainingTicks: snapshot.config.ticks - snapshot.tick,
    capacity: snapshot.config.capacity,
  };
}
async function until(game: Game, condition: (snapshot: Snapshot) => boolean) {
  for (let i = 0; i < 200 && !condition(game.snapshot()) && !game.snapshot().finished; i++)
    await game.step();
  assert.ok(
    condition(game.snapshot()),
    JSON.stringify(
      game.snapshot().bots.map((bot) => ({
        id: bot.id,
        position: bot.position,
        lastAction: bot.lastAction,
        errors: bot.errors,
      })),
    ),
  );
}
function escape(snapshot: Snapshot, post: Position, avoid?: Position): Position {
  return [
    { x: post.x + 1, y: post.y },
    { x: post.x - 1, y: post.y },
    { x: post.x, y: post.y - 1 },
    { x: post.x, y: post.y + 1 },
  ].find(
    (p) => Number.isFinite(terrainCost(snapshot.map, p)) && (!avoid || !samePosition(p, avoid)),
  )!;
}

test("hotspots and outposts are deterministic, finite, distinct, and reachable", () => {
  for (const baseLayout of ["edges", "center"] as const)
    for (const size of [13, 33])
      for (const botCount of [1, 4, 8]) {
        const config = normalizeConfig({
          width: size,
          height: size,
          baseLayout,
          hotspotCount: 6,
          outpostCount: 6,
          seed: "competition-sites",
        });
        const generated = generateMap(config, botCount);
        assert.deepStrictEqual(generated, generateMap(config, botCount));
        const { map, bases, resources, outposts, hotspots } = generated;
        assert.strictEqual(hotspots.length, 6);
        assert.strictEqual(outposts.length, 6);
        const reachable = distanceField(map, bases[0]!);
        assert.strictEqual(
          new Set([...bases, ...outposts, ...hotspots].map(positionKey)).size,
          bases.length + 12,
        );
        for (const post of outposts) {
          assert.ok(reachable.has(positionKey(post)));
          assert.strictEqual(map.tiles[post.y]![post.x], "grass");
          assert.strictEqual(post.ownerId, null);
          assert.ok(!resources.some((pile) => samePosition(pile, post)));
        }
        for (const hotspot of hotspots) {
          const stock = resources.filter((pile) => pile.hotspotId === hotspot.id);
          assert.ok(stock.length > 0 && stock.length <= 5);
          for (const pile of stock) {
            assert.ok(pile.kind === "relic" || pile.kind === "crystal");
            assert.ok(pile.amount >= 2 && pile.amount <= 3);
            assert.ok(
              Math.abs(pile.x - hotspot.x) + Math.abs(pile.y - hotspot.y) <= hotspot.radius,
            );
            assert.ok(reachable.has(positionKey(pile)));
          }
        }
      }
  const config = normalizeConfig({ hotspotCount: 0, outpostCount: 0, stealing: false });
  const classic = generateMap(config, 4);
  assert.deepStrictEqual(classic.hotspots, []);
  assert.deepStrictEqual(classic.outposts, []);
  assert.ok(classic.resources.every((pile) => !pile.hotspotId));
  assert.deepStrictEqual(generateMap(normalizeConfig({ resourceDensity: 0 }), 4).hotspots, []);
});

test("capture progress needs consecutive turns and cannot be farmed on an owned post", async () => {
  let mode: "capture" | "skip" = "capture";
  let post: Position;
  const game = new Game(
    [
      controller("a", (state) => {
        post = state.outposts[0]!;
        if (!samePosition(state.self.position, post)) return toward(state, post);
        if (mode === "capture" && state.outposts[0]!.ownerId !== "a") assert.ok(canCapture(state));
        return { type: mode };
      }),
    ],
    {
      seed: "capture-reset",
      width: 13,
      height: 13,
      ticks: 100,
      resourceDensity: 0,
      outpostCount: 1,
    },
  );
  try {
    await until(game, (snapshot) => snapshot.outposts[0]!.captureProgress === 1);
    mode = "skip";
    await game.step();
    assert.strictEqual(game.snapshot().outposts[0]!.captureProgress, 0);
    mode = "capture";
    await game.step();
    assert.strictEqual(game.snapshot().outposts[0]!.captureProgress, 1);
    await game.step();
    assert.strictEqual(game.snapshot().outposts[0]!.ownerId, null);
    await game.step();
    assert.strictEqual(game.snapshot().outposts[0]!.ownerId, "a");
    await game.step();
    assert.strictEqual(game.snapshot().bots[0]!.captures, 1);
    assert.strictEqual(game.result().standings[0]!.outpostsOwned, 1);
    assert.strictEqual(game.snapshot().bots[0]!.errors, 0);
  } finally {
    game.dispose();
  }
});

test("contested outposts block capture, can be reclaimed, and bank only for their owner", async () => {
  let phase: "gather" | "contest" | "claim" | "reclaim" = "gather";
  const loaded = new Set<string>();
  let target: Position, awayA: Position, awayB: Position;
  const bots = ["a", "b"].map((id) =>
    controller(id, (state) => {
      if (!loaded.has(id)) {
        if (state.self.inventory.length >= 2) loaded.add(id);
        else {
          const opening = {
            x: state.self.base.x,
            y: state.self.base.y + (state.self.base.y < (state.map.height - 1) / 2 ? 1 : -1),
          };
          return samePosition(state.self.position, opening)
            ? { type: "grab" }
            : toward(state, opening);
        }
      }
      const goal =
        phase === "claim" && id === "b"
          ? awayB
          : phase === "reclaim" && id === "a"
            ? awayA
            : target;
      if (!samePosition(state.self.position, goal)) {
        // Keep cargo for the banking assertions even when a generated route crosses home.
        const map = structuredClone(state.map);
        if (state.self.inventory.length && !samePosition(goal, state.self.base))
          map.tiles[state.self.base.y]![state.self.base.x] = "water";
        const direction = findPath(map, state.self.position, goal)?.steps[0];
        return direction ? { type: "move", direction } : { type: "skip" };
      }
      if (
        (phase === "contest" && id === "a") ||
        (phase === "claim" && id === "a") ||
        (phase === "reclaim" && id === "b")
      )
        return { type: "capture" };
      return { type: "skip" };
    }),
  );
  const game = new Game(bots, {
    seed: "reclaim",
    width: 13,
    height: 13,
    ticks: 250,
    outpostCount: 1,
    hotspotCount: 0,
  });
  target = game.snapshot().outposts[0]!;
  awayB = escape(game.snapshot(), target);
  awayA = escape(game.snapshot(), target, awayB);
  try {
    await until(game, (snapshot) =>
      snapshot.bots.every((bot) => samePosition(bot.position, target)),
    );
    assert.ok(game.snapshot().bots.every((bot) => bot.score === 0 && bot.inventory.length === 2));
    phase = "contest";
    await game.step();
    await game.step();
    assert.strictEqual(game.snapshot().outposts[0]!.captureProgress, 0);
    assert.strictEqual(game.snapshot().outposts[0]!.ownerId, null);
    phase = "claim";
    await until(game, (snapshot) => snapshot.outposts[0]!.ownerId === "a");
    assert.strictEqual(game.snapshot().bots[0]!.score, 14);
    assert.strictEqual(game.snapshot().bots[1]!.score, 0);
    const stateA = observation(game.snapshot(), "a");
    assert.strictEqual(getNearestBank(stateA)!.site.id, "outpost-1");
    assert.strictEqual(getBankingSites(stateA).length, 2);
    phase = "reclaim";
    await until(game, (snapshot) => snapshot.outposts[0]!.ownerId === "b");
    assert.strictEqual(game.snapshot().bots[1]!.score, 14);
    assert.strictEqual(getBankingSites(observation(game.snapshot(), "a")).length, 1);
    assert.ok(game.snapshot().bots.every((bot) => bot.captures === 1 && bot.errors === 0));
    const replay = parseReplay(game.replay());
    assert.strictEqual(replay.frames.at(-1)!.outposts[0]!.ownerId, "b");
    replay.frames.at(-1)!.outposts[0]!.ownerId = "unknown";
    assert.throws(() => parseReplay(replay));
  } finally {
    game.dispose();
  }
});

test("theft conserves cargo, enforces cooldown and escape protection, and banks stolen items", async () => {
  let target: Position;
  let returnHome = false;
  const stealTicks: number[] = [];
  const game = new Game(
    [
      controller("victim", (state) => {
        target = { x: state.self.base.x, y: state.self.base.y + 1 };
        if (!samePosition(state.self.position, target)) return toward(state, target);
        if (state.resources.some((pile) => samePosition(pile, target))) return { type: "grab" };
        return { type: "skip" };
      }),
      controller("thief", (state) => {
        if (returnHome) return { type: "home" };
        if (!samePosition(state.self.position, target)) return toward(state, target);
        if (canSteal(state, "victim")) stealTicks.push(state.tick);
        return { type: "steal", targetId: "victim" };
      }),
    ],
    { seed: "theft-cooldown", width: 13, height: 13, ticks: 200, hotspotCount: 0, outpostCount: 0 },
  );
  try {
    await until(game, (snapshot) => snapshot.bots[1]!.stolen === 1);
    const first = game.snapshot();
    assert.strictEqual(first.bots[0]!.inventory.length + first.bots[1]!.inventory.length, 2);
    assert.strictEqual(first.bots[0]!.lost, 1);
    const stealTick = first.tick - 1;
    assert.strictEqual(first.bots[1]!.stealReadyTick, stealTick + 5);
    const protectedVictim = observation(first, "victim");
    assert.strictEqual(canSteal(protectedVictim, "thief"), false);
    assert.strictEqual(canSteal(observation(first, "thief"), "victim"), false);
    await until(game, (snapshot) => snapshot.bots[1]!.stolen === 2);
    assert.deepStrictEqual(stealTicks, [stealTick, stealTick + 5]);
    assert.strictEqual(game.snapshot().bots[0]!.inventory.length, 0);
    assert.strictEqual(game.snapshot().bots[1]!.score, 0);
    returnHome = true;
    await until(game, (snapshot) => snapshot.bots[1]!.score === 14);
    assert.ok(game.snapshot().bots.every((bot) => bot.errors === 0));
    assert.strictEqual(game.result().standings.find((bot) => bot.id === "thief")!.stolen, 2);
  } finally {
    game.dispose();
  }
});

test("base tiles are safe even when a visiting rival is carrying cargo", async () => {
  let safeBase: Position;
  let loaded = false;
  const game = new Game(
    [
      controller("victim", (state) => {
        if (!loaded && state.self.inventory.length >= 2) loaded = true;
        const opening = { x: state.self.base.x, y: state.self.base.y + 1 };
        if (!loaded)
          return samePosition(state.self.position, opening)
            ? { type: "grab" }
            : toward(state, opening);
        return toward(state, safeBase);
      }),
      controller("thief", (state) => {
        safeBase = state.self.base;
        return { type: "steal", targetId: "victim" };
      }),
    ],
    { seed: "safe-base", width: 13, height: 13, ticks: 150, hotspotCount: 0, outpostCount: 0 },
  );
  try {
    await until(
      game,
      (snapshot) => !!safeBase && samePosition(snapshot.bots[0]!.position, safeBase),
    );
    await game.step();
    await game.step();
    assert.strictEqual(game.snapshot().bots[0]!.inventory.length, 2);
    assert.strictEqual(game.snapshot().bots[1]!.stolen, 0);
    assert.deepStrictEqual(getStealTargets(observation(game.snapshot(), "thief")), []);
  } finally {
    game.dispose();
  }
});

test("SDK theft selection respects capacity, eligibility, and disabled theft settings", () => {
  const game = new Game([
    controller("a", () => ({ type: "skip" })),
    controller("b", () => ({ type: "skip" })),
  ]);
  try {
    const snapshot = game.snapshot();
    snapshot.bots[0]!.position = { x: snapshot.bots[0]!.base.x, y: snapshot.bots[0]!.base.y + 1 };
    snapshot.bots[1]!.position = { ...snapshot.bots[0]!.position };
    snapshot.bots[0]!.inventory = ["relic", "relic"];
    snapshot.bots[1]!.inventory = ["ore", "crystal", "relic"];
    const state = observation(snapshot, "a");
    assert.deepStrictEqual(getStealTargets(state), [
      { botId: "b", kind: "crystal", value: 7, weight: 2 },
    ]);
    state.config.stealing = false;
    assert.strictEqual(canSteal(state, "b"), false);
    state.config.stealing = true;
    state.self.stealReadyTick = state.tick + 1;
    assert.strictEqual(canSteal(state, "b"), false);
  } finally {
    game.dispose();
  }
});

test("trip plans use owned outposts and stop using them when ownership changes", () => {
  const game = new Game([controller("a", () => ({ type: "skip" }))]);
  try {
    const state = observation(game.snapshot(), "a");
    const post = state.outposts[0]!;
    post.ownerId = "a";
    const pile = state.resources.find(
      (pile) =>
        findPath(state.map, pile, post)!.cost < findPath(state.map, pile, state.self.base)!.cost,
    )!;
    assert.ok(pile);
    assert.strictEqual(planTrip(state, pile).bank!.id, post.id);
    post.ownerId = null;
    assert.strictEqual(planTrip(state, pile).bank!.kind, "base");
  } finally {
    game.dispose();
  }
});

test("legacy replays import with neutral competition defaults without changing the input", async () => {
  const game = new Game([controller("a", () => ({ type: "skip" }))], {
    ticks: 1,
    hotspotCount: 0,
    outpostCount: 0,
    stealing: false,
  });
  try {
    await game.step();
    const raw = JSON.parse(JSON.stringify(game.replay()));
    for (const frame of [raw.initial, ...raw.frames]) {
      delete frame.hotspots;
      delete frame.outposts;
      for (const bot of frame.bots)
        for (const key of [
          "captures",
          "stolen",
          "lost",
          "stealReadyTick",
          "theftProtectedUntilTick",
        ])
          delete bot[key];
    }
    for (const key of [
      "hotspotCount",
      "outpostCount",
      "stealing",
      "captureTurns",
      "stealCooldownTicks",
    ])
      delete raw.initial.config[key];
    const replay = parseReplay(raw);
    assert.deepStrictEqual(replay.initial.outposts, []);
    assert.strictEqual(replay.initial.config.stealing, false);
    assert.strictEqual(replay.initial.bots[0]!.stolen, 0);
    assert.strictEqual(raw.initial.outposts, undefined);
  } finally {
    game.dispose();
  }
});

test("competitive settings are configurable through the CLI and reject invalid values", () => {
  const parsed = configFromFlags(
    parseArguments([
      "play",
      "--hotspots",
      "3",
      "--outposts",
      "1",
      "--capture-turns",
      "2",
      "--stealing",
      "false",
      "--steal-cooldown",
      "7",
    ]).flags,
  );
  assert.partialDeepStrictEqual(parsed, {
    hotspotCount: 3,
    outpostCount: 1,
    captureTurns: 2,
    stealing: false,
    stealCooldownTicks: 7,
  });
  assert.throws(() => normalizeConfig({ hotspotCount: 7 }));
  assert.throws(() => normalizeConfig({ captureTurns: 0 }));
  assert.throws(() => configFromFlags(parseArguments(["--stealing", "yes"]).flags));
});
