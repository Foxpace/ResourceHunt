import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMap } from "../src/engine/map.ts";
import { normalizeConfig } from "../src/engine/config.ts";
import { distanceField, positionKey } from "../src/engine/pathfinding.ts";

test("bridges span the entire river with water beneath every deck tile", () => {
  const sizes = [
    [13, 13],
    [14, 19],
    [33, 25],
    [13, 81],
    [81, 13],
    [81, 81],
  ] as const;
  for (const [width, height] of sizes) {
    for (const baseLayout of ["edges", "center"] as const) {
      for (let count = 1; count <= 8; count++) {
        for (let seed = 0; seed < 6; seed++) {
          const context = `${width}x${height}, ${baseLayout}, ${count} bots, seed ${seed}`;
          const { map, bases, resources } = generateMap(
            normalizeConfig({ width, height, baseLayout, seed: String(seed) }),
            count,
          );
          let crossings = 0;
          let previousLeft = -1,
            previousRight = -1;
          for (let y = 0; y < height; y++) {
            const row = map.tiles[y]!;
            const wet = row
              .map((tile, x) => (tile === "water" || tile === "bridge" ? x : -1))
              .filter((x) => x >= 0);
            const left = wet[0]!,
              right = wet.at(-1)!;
            assert.ok(wet.length >= 2 && wet.length <= 5, context);
            assert.strictEqual(wet.length, right - left + 1, `Broken channel: ${context}`);
            assert.ok(left > 0 && right < width - 1, `Missing riverbank: ${context}`);
            if (y > 0)
              assert.ok(
                left <= previousRight && previousLeft <= right,
                `Disconnected river: ${context}`,
              );
            previousLeft = left;
            previousRight = right;

            if (row.includes("bridge")) {
              crossings++;
              for (const x of wet) {
                assert.strictEqual(row[x], "bridge", `Partial crossing: ${context}`);
                assert.strictEqual(map.tiles[y - 1]?.[x], "water", `Bridge on land: ${context}`);
                assert.strictEqual(map.tiles[y + 1]?.[x], "water", `Bridge on land: ${context}`);
              }
              assert.ok(row[left - 1] !== "water" && row[right + 1] !== "water", context);
            }
          }
          assert.ok(crossings >= 2, context);
          for (const base of bases) {
            assert.strictEqual(map.tiles[base.y]![base.x], "grass", context);
            const openingY = base.y + (base.y < (height - 1) / 2 ? 1 : -1);
            assert.strictEqual(map.tiles[openingY]![base.x], "grass", context);
          }
          for (const pile of resources) assert.ok(map.tiles[pile.y]![pile.x] !== "bridge", context);
        }
      }
    }
  }
});

test("wide river crossings keep both banks, bases, and resources reachable", () => {
  for (const baseLayout of ["edges", "center"] as const) {
    for (let seed = 0; seed < 12; seed++) {
      const { map, bases, resources } = generateMap(
        normalizeConfig({ baseLayout, seed: `river-${seed}` }),
        8,
      );
      const reachable = distanceField(map, bases[0]!);
      for (const base of bases) assert.ok(reachable.has(positionKey(base)));
      for (const pile of resources) assert.ok(reachable.has(positionKey(pile)));
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (map.tiles[y]![x] !== "water") assert.ok(reachable.has(`${x},${y}`));
        }
      }
      const spans = map.tiles.map(
        (row) => row.filter((tile) => tile === "water" || tile === "bridge").length,
      );
      assert.ok(Math.max(...spans) >= 3);
      assert.ok(new Set(spans).size > 1, "River should have wider and narrower sections");
    }
  }
});
