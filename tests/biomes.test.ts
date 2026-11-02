import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMap, normalizeConfig, Game, parseReplay } from "../src/index.ts";
import {
  BIOMES,
  distanceField,
  positionKey,
  terrainCost,
  findPath,
  type Biome,
  type BotController,
  type Terrain,
} from "../src/index.ts";
import { configFromFlags, parseArguments } from "../src/cli/options.ts";
import { minimumMapSize } from "../src/engine/map-layout.ts";

const biomes = Object.keys(BIOMES) as Biome[];

test("every biome is seeded and uses a distinct terrain template", () => {
  const signatures = new Set<string>();
  const expected: Record<Biome, Terrain[]> = {
    riverlands: ["grass", "water", "bridge"],
    valley: ["grass", "cliff", "mountain"],
    desert: ["sand", "dune", "oasis"],
    moon: ["regolith", "crater", "cliff"],
    volcanic: ["basalt", "ash", "lava"],
    archipelago: ["water", "bridge", "grass"],
    tundra: ["snow", "ice", "water"],
    forest: ["grass", "forest", "thicket"],
  };
  for (const biome of biomes) {
    const config = normalizeConfig({ biome, seed: "biome-templates" });
    const first = generateMap(config, 4);
    assert.deepStrictEqual(first, generateMap(config, 4), biome);
    assert.notDeepStrictEqual(first.map, generateMap({ ...config, seed: "other" }, 4).map, biome);
    const tiles = first.map.tiles.flat();
    for (const terrain of expected[biome])
      assert.ok(tiles.includes(terrain), `${biome}: missing ${terrain}`);
    signatures.add(JSON.stringify(first.map.tiles));
    if (biome === "archipelago") {
      assert.ok(tiles.filter((tile) => tile === "water").length > tiles.length * 0.25);
      assert.ok(
        first.map.tiles.some((row, y) =>
          row.some((tile, x) => tile === "bridge" && first.map.tiles[y + 1]?.[x] === "bridge"),
        ),
        "Islands need vertical crossings too",
      );
    }
    if (biome === "moon" || biome === "volcanic")
      assert.ok(!tiles.includes("grass"), "Bases and outposts must retain their theme");
  }
  assert.strictEqual(signatures.size, biomes.length);
});

test("all biome land, bases, resources, and strategic sites remain reachable", () => {
  const sizes = [
    [13, 13],
    [14, 19],
    [33, 25],
    [13, 81],
    [81, 13],
    [81, 81],
  ] as const;
  for (const biome of biomes)
    for (const [width, height] of sizes) {
      for (const baseLayout of ["edges", "center"] as const)
        for (const botCount of [1, 4, 8]) {
          const label = `${biome}, ${width}x${height}, ${baseLayout}, ${botCount}`;
          const config = normalizeConfig({
            biome,
            width,
            height,
            baseLayout,
            seed: label,
            hotspotCount: 6,
            outpostCount: 6,
          });
          const { map, bases, resources, hotspots, outposts } = generateMap(config, botCount);
          const reachable = distanceField(map, bases[0]!);
          for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++) {
              if (Number.isFinite(terrainCost(map, { x, y })))
                assert.ok(reachable.has(`${x},${y}`), `${label}: isolated land at ${x},${y}`);
            }
          assert.strictEqual(new Set(bases.map(positionKey)).size, botCount, label);
          for (const base of bases) {
            assert.strictEqual(terrainCost(map, base), 1, label);
            const opening = { x: base.x, y: base.y + (base.y < (height - 1) / 2 ? 1 : -1) };
            assert.strictEqual(terrainCost(map, opening), 1, label);
          }
          for (const site of [...bases, ...resources, ...hotspots, ...outposts])
            assert.ok(reachable.has(positionKey(site)), label);
          for (const pile of resources)
            assert.notStrictEqual(map.tiles[pile.y]![pile.x], "bridge", label);
          for (const post of outposts)
            assert.strictEqual(map.tiles[post.y]![post.x], BIOMES[biome].spawnTerrain, label);
          for (const hotspot of hotspots)
            assert.ok(
              resources.some((pile) => pile.hotspotId === hotspot.id),
              `${label}: empty hotspot`,
            );
        }
    }
});

test("biome selection validates through CLI and config, with Riverlands as default", () => {
  assert.strictEqual(normalizeConfig().biome, "riverlands");
  for (const biome of biomes) {
    assert.strictEqual(
      configFromFlags(parseArguments(["play", "--biome", biome]).flags).biome,
      biome,
    );
  }
  assert.throws(() => normalizeConfig({ biome: "unknown" as Biome }), /biome must be/);
  assert.throws(() => configFromFlags(new Map([["biome", "toString"]])), /biome must be/);
});

test("ten and fifteen players have separate bases, supplies, and reachable starts in every biome", () => {
  for (const biome of biomes)
    for (const count of [10, 15])
      for (const baseLayout of ["edges", "center"] as const) {
        for (let seed = 0; seed < 4; seed++) {
          const config = normalizeConfig({ biome, baseLayout, seed: `crowded-${seed}` });
          const { map, bases, resources, hotspots, outposts } = generateMap(config, count);
          const label = `${biome}, ${count}, ${baseLayout}, ${seed}`;
          const reachable = distanceField(map, bases[0]!);
          const baseKeys = new Set(bases.map(positionKey));
          const openings = bases.map((base) => ({
            x: base.x,
            y: base.y + (base.y < (map.height - 1) / 2 ? 1 : -1),
          }));
          assert.strictEqual(baseKeys.size, count, label);
          assert.strictEqual(new Set(openings.map(positionKey)).size, count, label);
          for (const opening of openings) {
            assert.ok(!baseKeys.has(positionKey(opening)), label);
            assert.strictEqual(terrainCost(map, opening), 1, label);
            assert.ok(
              resources.some(
                (pile) =>
                  positionKey(pile) === positionKey(opening) &&
                  pile.kind === "crystal" &&
                  pile.amount === 2,
              ),
              label,
            );
          }
          for (const p of [...bases, ...resources, ...hotspots, ...outposts])
            assert.ok(reachable.has(positionKey(p)), label);
          for (const base of bases)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++)
                if (map.tiles[base.y + dy]?.[base.x + dx] !== "water")
                  assert.strictEqual(
                    terrainCost(map, { x: base.x + dx, y: base.y + dy }),
                    1,
                    label,
                  );
        }
      }
  assert.strictEqual(minimumMapSize(15, "valley"), 25);
  assert.throws(() => generateMap(normalizeConfig({ width: 13, height: 13 }), 15), /at least 25/);
  assert.throws(() => generateMap(normalizeConfig(), 16), /15 bots/);
});

test("Archipelago crossings have equal lengths and every base is two moves from a bridge", () => {
  for (const count of [1, 4, 8, 10, 15])
    for (const baseLayout of ["edges", "center"] as const)
      for (const size of [25, 33, 81]) {
        const { map, bases } = generateMap(
          normalizeConfig({ biome: "archipelago", width: size, height: size, baseLayout }),
          count,
        );
        const visited = new Set<string>();
        const lengths = new Set<number>();
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++) {
            if (map.tiles[y]![x] !== "bridge" || visited.has(`${x},${y}`)) continue;
            const queue = [{ x, y }];
            visited.add(`${x},${y}`);
            for (let i = 0; i < queue.length; i++)
              for (const [dx, dy] of [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ]) {
                const p = { x: queue[i]!.x + dx!, y: queue[i]!.y + dy! },
                  key = positionKey(p);
                if (map.tiles[p.y]?.[p.x] === "bridge" && !visited.has(key)) {
                  visited.add(key);
                  queue.push(p);
                }
              }
            lengths.add(queue.length);
            assert.ok(
              queue.every((p) => p.x === x) || queue.every((p) => p.y === y),
              "Crossings are straight",
            );
            for (const p of queue) {
              assert.strictEqual(
                map.tiles[p.y]![size - 1 - p.x],
                "bridge",
                "Mirrored east/west crossing",
              );
              assert.strictEqual(
                map.tiles[size - 1 - p.y]![p.x],
                "bridge",
                "Mirrored north/south crossing",
              );
            }
          }
        assert.strictEqual(lengths.size, 1, `${count}, ${size}, ${baseLayout}`);
        for (const base of bases) {
          const costs = distanceField(map, base);
          assert.strictEqual(Math.min(...[...visited].map((key) => costs.get(key)!.cost)), 2);
        }
      }
});

test("hotspots follow terrain and seeds rather than fixed central targets", () => {
  for (const biome of biomes) {
    const positions = new Set<string>();
    let outerSites = 0;
    for (let seed = 0; seed < 12; seed++) {
      const config = normalizeConfig({ biome, seed: `sites-${seed}`, hotspotCount: 4 });
      const { map, hotspots, bases } = generateMap(config, 4);
      positions.add(hotspots.map(positionKey).join(";"));
      for (const site of hotspots) {
        assert.ok(Number.isFinite(terrainCost(map, site)));
        assert.ok(!bases.some((base) => positionKey(base) === positionKey(site)));
        if (
          Math.abs(site.x - (map.width - 1) / 2) > map.width * 0.25 ||
          Math.abs(site.y - (map.height - 1) / 2) > map.height * 0.25
        )
          outerSites++;
      }
    }
    assert.strictEqual(positions.size, 12, biome);
    assert.ok(outerSites > 0, `${biome}: every hotspot stayed in the middle`);
  }
});

test("bots see biome terrain costs and the engine spends the same travel turns", async () => {
  for (const biome of biomes) {
    let calls = 0;
    let destination: { x: number; y: number } | undefined;
    const controller: BotController = {
      metadata: { id: "traveler", name: "Traveler", description: "Terrain timing" },
      async decide(state) {
        calls++;
        assert.strictEqual(state.config.biome, biome);
        if (destination) return { action: { type: "skip" } };
        for (let y = 0; y < state.map.height; y++)
          for (let x = 0; x < state.map.width; x++) {
            const cost = terrainCost(state.map, { x, y });
            if (cost > 1 && Number.isFinite(cost)) {
              const direction = findPath(state.map, state.self.position, { x, y })?.steps[0];
              if (direction) return { action: { type: "move", direction } };
            }
          }
        return { action: { type: "skip" } };
      },
      dispose() {},
    };
    const game = new Game([controller], { biome, ticks: 100 });
    try {
      for (let i = 0; i < 90; i++) {
        const after = await game.step();
        const remaining = after.bots[0]!.travelRemaining;
        if (remaining) {
          destination = after.bots[0]!.position;
          assert.strictEqual(remaining, terrainCost(after.map, destination) - 1);
          const beforeCalls = calls;
          for (let travel = 0; travel < remaining; travel++) await game.step();
          assert.strictEqual(calls, beforeCalls, biome);
          await game.step();
          assert.strictEqual(calls, beforeCalls + 1, biome);
          break;
        }
      }
      assert.ok(destination, `${biome}: did not visit slow terrain`);
      assert.strictEqual(game.result().standings[0]!.errors, 0);
      const replay = game.replay();
      assert.deepStrictEqual(parseReplay(JSON.parse(JSON.stringify(replay))), replay);
    } finally {
      game.dispose();
    }
  }
});

test("old replays without a biome retain the Riverlands theme", async () => {
  const game = new Game(
    [
      {
        metadata: { id: "idle", name: "Idle", description: "Legacy" },
        async decide() {
          return { action: { type: "skip" } };
        },
        dispose() {},
      },
    ],
    { ticks: 1 },
  );
  await game.step();
  const replay = JSON.parse(JSON.stringify(game.replay()));
  delete replay.initial.config.biome;
  delete replay.result.config.biome;
  assert.strictEqual(parseReplay(replay).initial.config.biome, "riverlands");
});
