import assert from "node:assert/strict";
import { BIOMES, distanceField, positionKey, terrainCost } from "../../src/index.ts";
import { mapCells } from "../../src/engine/grid.ts";
import type { Biome, GameMap, Position, Terrain } from "../../src/engine/types.ts";
import type { GeneratedMap } from "./map-fixtures.ts";

export function assertMapReachable(generated: GeneratedMap): void {
  const { map, bases, resources, hotspots, outposts } = generated;
  const reachable = distanceField(map, bases[0]!);
  for (const site of [...bases, ...resources, ...hotspots, ...outposts]) {
    assert.ok(reachable.has(positionKey(site)), `Unreachable site ${positionKey(site)}`);
  }
  for (const position of mapCells(map)) {
    if (!Number.isFinite(terrainCost(map, position))) continue;

    assert.ok(reachable.has(positionKey(position)), `Unreachable land ${positionKey(position)}`);
  }
  assert.equal(new Set(bases.map(positionKey)).size, bases.length);
}

export function assertStartingTerrain(generated: GeneratedMap, biome: Biome): void {
  const { map, bases, outposts } = generated;
  for (const base of bases) {
    assert.equal(terrainCost(map, base), 1);
    assert.equal(map.tiles[base.y]![base.x], BIOMES[biome].spawnTerrain);
    assert.equal(terrainCost(map, openingPosition(map, base)), 1);
  }
  for (const outpost of outposts) {
    assert.equal(map.tiles[outpost.y]![outpost.x], BIOMES[biome].spawnTerrain);
  }
  for (const pile of generated.resources) {
    assert.notEqual(map.tiles[pile.y]![pile.x], "bridge");
  }
  for (const hotspot of generated.hotspots) {
    assert.ok(generated.resources.some((pile) => pile.hotspotId === hotspot.id));
  }
}

export function assertOpeningSupplies(generated: GeneratedMap): void {
  const { map, bases, resources } = generated;
  const baseKeys = new Set(bases.map(positionKey));
  const openings = bases.map((base) => openingPosition(map, base));
  assert.equal(baseKeys.size, bases.length);
  assert.equal(new Set(openings.map(positionKey)).size, bases.length);
  for (const opening of openings) {
    assert.ok(!baseKeys.has(positionKey(opening)));
    assert.equal(terrainCost(map, opening), 1);
    assert.ok(
      resources.some((pile) => {
        const sharesOpeningTile = positionKey(pile) === positionKey(opening);
        const isCrystal = pile.kind === "crystal";
        const hasStartingAmount = pile.amount === 2;

        return sharesOpeningTile && isCrystal && hasStartingAmount;
      }),
    );
  }
  for (const base of bases) assertBaseNeighborhood(map, base);
}

function assertBaseNeighborhood(map: GameMap, base: Position): void {
  for (const position of mapCells(map)) {
    const nearby = Math.abs(position.x - base.x) <= 1 && Math.abs(position.y - base.y) <= 1;
    const water = map.tiles[position.y]![position.x] === "water";
    if (!nearby || water) continue;

    assert.equal(terrainCost(map, position), 1);
  }
}

export function openingPosition(map: GameMap, base: Position): Position {
  return { x: base.x, y: base.y + (base.y < (map.height - 1) / 2 ? 1 : -1) };
}

export function assertRiverCrossings(map: GameMap): void {
  let crossings = 0;
  let previous = { left: -1, right: -1 };
  for (const [rowIndex, row] of map.tiles.entries()) {
    const channel = riverChannel(row);
    assert.ok(channel.positions.length >= 2 && channel.positions.length <= 5);
    assert.equal(channel.positions.length, channel.right - channel.left + 1);
    assert.ok(channel.left > 0 && channel.right < map.width - 1);
    if (rowIndex > 0) assert.ok(channel.left <= previous.right && previous.left <= channel.right);

    previous = channel;
    if (!row.includes("bridge")) continue;

    crossings++;
    assertBridgeRow(map, { rowIndex, ...channel });
  }
  assert.ok(crossings >= 2);
}

function riverChannel(row: Terrain[]) {
  const positions = row.flatMap((terrain, index) => {
    const isWater = terrain === "water";
    const isBridge = terrain === "bridge";

    return isWater || isBridge ? [index] : [];
  });

  return { positions, left: positions[0]!, right: positions.at(-1)! };
}

function assertBridgeRow(
  map: GameMap,
  channel: ReturnType<typeof riverChannel> & { rowIndex: number },
): void {
  const { rowIndex, positions, left, right } = channel;
  const row = map.tiles[rowIndex]!;
  for (const column of positions) {
    assert.equal(row[column], "bridge", "Every river tile must have a deck");
    assert.equal(map.tiles[rowIndex - 1]?.[column], "water", "Bridge must span water");
    assert.equal(map.tiles[rowIndex + 1]?.[column], "water", "Bridge must span water");
  }
  assert.ok(row[left - 1] !== "water" && row[right + 1] !== "water");
}

export function assertVariableRiverWidth(map: GameMap): void {
  const spans = map.tiles.map((row) => riverChannel(row).positions.length);
  assert.ok(Math.max(...spans) >= 3);
  assert.ok(new Set(spans).size > 1, "River should have wider and narrower sections");
}
