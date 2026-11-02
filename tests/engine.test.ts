import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine/game.ts";
import { generateMap } from "../src/engine/map.ts";
import { normalizeConfig } from "../src/engine/config.ts";
import {
  distanceField,
  findPath,
  positionKey,
  samePosition,
  terrainCost,
} from "../src/engine/pathfinding.ts";
import { parseReplay } from "../src/engine/replay.ts";
import { randomFromSeed } from "../src/engine/random.ts";
import type { BotController, Observation } from "../src/engine/types.ts";

function scripted(id: string, decide: (state: Observation) => unknown): BotController {
  return {
    metadata: { id, name: id, description: "Test bot" },
    async decide(state) {
      return { action: decide(state) };
    },
    dispose() {},
  };
}
const settings = { width: 13, height: 13, seed: "rules", ticks: 10 };

describe("map and paths", () => {
  test("seeds reproduce maps and random sequences", () => {
    const config = normalizeConfig(settings);
    assert.deepStrictEqual(generateMap(config, 4), generateMap(config, 4));
    assert.notDeepStrictEqual(generateMap(config, 4), generateMap({ ...config, seed: "other" }, 4));
    const a = randomFromSeed("test"),
      b = randomFromSeed("test");
    assert.deepStrictEqual(Array.from({ length: 100 }, a), Array.from({ length: 100 }, b));
  });
  test("all land, bases, and resources are reachable over varied seeds and layouts", () => {
    for (const baseLayout of ["edges", "center"] as const)
      for (let seed = 0; seed < 24; seed++) {
        const { map, bases, resources } = generateMap(
          normalizeConfig({ ...settings, baseLayout, seed: String(seed) }),
          8,
        );
        const reachable = distanceField(map, bases[0]!);
        assert.strictEqual(new Set(bases.map(positionKey)).size, 8);
        for (const base of bases) assert.strictEqual(reachable.has(positionKey(base)), true);
        for (const pile of resources) assert.strictEqual(reachable.has(positionKey(pile)), true);
        for (let y = 0; y < map.height; y++)
          for (let x = 0; x < map.width; x++)
            if (Number.isFinite(terrainCost(map, { x, y })))
              assert.strictEqual(reachable.has(`${x},${y}`), true);
      }
  });
  test("weighted paths prefer faster terrain, reject rivers and handle home", () => {
    const map = {
      width: 3,
      height: 2,
      tiles: [
        ["grass", "mountain", "grass"],
        ["grass", "grass", "grass"],
      ],
    } as const;
    const mutable = structuredClone(map) as unknown as import("../src/sdk.ts").GameMap;
    assert.deepStrictEqual(findPath(mutable, { x: 0, y: 0 }, { x: 2, y: 0 }), {
      cost: 4,
      steps: ["E", "E"],
    });
    mutable.tiles[0]![1] = "water";
    assert.deepStrictEqual(findPath(mutable, { x: 0, y: 0 }, { x: 2, y: 0 })?.steps, [
      "S",
      "E",
      "E",
      "N",
    ]);
    assert.deepStrictEqual(findPath(mutable, { x: 0, y: 0 }, { x: 0, y: 0 }), {
      cost: 0,
      steps: [],
    });
    assert.strictEqual(findPath(mutable, { x: 0, y: 0 }, { x: -1, y: 0 }), null);
  });
  test("configuration rejects invalid inputs", () => {
    for (const config of [
      { width: 12 },
      { ticks: 0 },
      { capacity: 2 },
      { terrainDensity: NaN },
      { seed: "" },
      { decisionTimeoutMs: 1 },
    ])
      assert.throws(() => normalizeConfig(config));
  });
});

describe("game rules", () => {
  test("grab is one unit, capacity is enforced, home moves and deposits", async () => {
    const actions = [
      { type: "move", direction: "S" },
      { type: "grab" },
      { type: "grab" },
      { type: "home" },
    ];
    const game = new Game([scripted("test", (state) => actions[state.tick] ?? { type: "skip" })], {
      ...settings,
      capacity: 3,
    });
    const initial = game.snapshot();
    await game.step();
    assert.strictEqual(game.snapshot().bots[0]!.position.y, initial.bots[0]!.base.y + 1);
    await game.step();
    assert.deepStrictEqual(game.snapshot().bots[0]!.inventory, ["crystal"]);
    assert.strictEqual(game.result().standings[0]!.score, 0);
    await game.step();
    assert.deepStrictEqual(game.snapshot().bots[0]!.inventory, ["crystal"]);
    await game.step();
    assert.partialDeepStrictEqual(game.result().standings[0], {
      score: 7,
      delivered: 1,
      carriedValue: 0,
    });
    assert.strictEqual(
      samePosition(game.snapshot().bots[0]!.position, initial.bots[0]!.base),
      true,
    );
    game.dispose();
  });
  test("carry value does not score at the deadline, fixed ticks stop further decisions", async () => {
    let calls = 0,
      disposed = false;
    const bot = scripted("test", (state) => {
      calls++;
      return state.tick ? { type: "grab" } : { type: "move", direction: "S" };
    });
    bot.dispose = () => {
      disposed = true;
    };
    const game = new Game([bot], { ...settings, ticks: 2 });
    await game.step();
    await game.step();
    await game.step();
    assert.strictEqual(calls, 2);
    assert.strictEqual(disposed, true);
    assert.partialDeepStrictEqual(game.result().standings[0], { score: 0, carriedValue: 7 });
    assert.strictEqual(game.snapshot().finished, true);
  });
  test("turn order rotates and each decision sees earlier changes", async () => {
    const observations: string[] = [];
    const bots = ["a", "b", "c"].map((id) =>
      scripted(id, (state) => {
        observations.push(
          `${state.tick}:${id}:${state.bots.filter((bot) => bot.lastAction === "Skipped").length}`,
        );
        return { type: "skip" };
      }),
    );
    const game = new Game(bots, { ...settings, ticks: 3 });
    await game.step();
    await game.step();
    await game.step();
    assert.deepStrictEqual(observations.slice(0, 3), ["0:a:0", "0:b:1", "0:c:2"]);
    assert.deepStrictEqual(
      observations.map((row) => row.slice(0, 3)),
      ["0:a", "0:b", "0:c", "1:b", "1:c", "1:a", "2:c", "2:a", "2:b"],
    );
    assert.deepStrictEqual(
      game.result().standings.map((bot) => bot.rank),
      [1, 1, 1],
    );
  });
  test("observations and returned snapshots cannot change engine state", async () => {
    const game = new Game(
      [
        scripted("test", (state) => {
          state.self.score = 999;
          state.map.tiles[0]![0] = "water";
          state.resources.length = 0;
          return { type: "skip" };
        }),
      ],
      settings,
    );
    const initial = game.snapshot();
    initial.bots[0]!.score = 100;
    await game.step();
    assert.strictEqual(game.result().standings[0]!.score, 0);
    assert.ok(game.snapshot().resources.length > 0);
    game.dispose();
  });
  test("invalid actions and exceptions cost a turn and are reported", async () => {
    const game = new Game(
      [
        scripted("test", (state) => {
          if (state.tick === 1) throw new Error("broken strategy");
          return { type: "move", direction: "__proto__" };
        }),
      ],
      { ...settings, ticks: 2 },
    );
    await game.step();
    await game.step();
    assert.strictEqual(game.result().standings[0]!.errors, 2);
    assert.strictEqual(game.snapshot().events[0]!.message, "broken strategy");
  });
  test("rough terrain consumes its movement cost before the next decision", async () => {
    let calls = 0;
    let target: { x: number; y: number };
    const game = new Game(
      [
        scripted("test", (state) => {
          calls++;
          if (!target) {
            const routes = distanceField(state.map, state.self.position);
            const key = [...routes.keys()].find((key) => {
              const [x, y] = key.split(",").map(Number) as [number, number];
              return state.map.tiles[y]![x] === "mountain";
            })!;
            const [x, y] = key.split(",").map(Number) as [number, number];
            target = { x, y };
          }
          const direction = findPath(state.map, state.self.position, target)?.steps[0];
          return direction ? { type: "move", direction } : { type: "skip" };
        }),
      ],
      { ...settings, ticks: 100 },
    );
    for (let i = 0; i < 90; i++) {
      await game.step();
      if (samePosition(game.snapshot().bots[0]!.position, target!)) break;
    }
    assert.strictEqual(game.snapshot().bots[0]!.travelRemaining, 2);
    const callsAtArrival = calls;
    await game.step();
    await game.step();
    assert.strictEqual(calls, callsAtArrival);
    await game.step();
    assert.strictEqual(calls, callsAtArrival + 1);
    game.dispose();
  });
  test("replay preserves initial state and every tick, rejects corrupt coordinates", async () => {
    const game = new Game([scripted("test", () => ({ type: "skip" }))], { ...settings, ticks: 3 });
    await game.step();
    await game.step();
    await game.step();
    const replay = parseReplay(JSON.parse(JSON.stringify(game.replay())));
    assert.strictEqual(replay.initial.tick, 0);
    assert.deepStrictEqual(
      replay.frames.map((frame) => frame.tick),
      [1, 2, 3],
    );
    replay.frames[0]!.bots[0]!.position.x = -1;
    assert.throws(() => parseReplay(replay));
  });
});
