import type { GameMap } from "./types.ts";

const observationTerrain = new WeakMap<GameMap, GameMap>();

export function copyTerrain(terrain: GameMap): GameMap {
  return { ...terrain, tiles: terrain.tiles.map((row) => row.slice()) };
}

/** Give a bot its own map while retaining the private terrain for reuse. */
export function copyObservationTerrain(terrain: GameMap): GameMap {
  const map = copyTerrain(terrain);
  observationTerrain.set(terrain, terrain);
  observationTerrain.set(map, terrain);

  return map;
}

/** The private terrain also identifies the revision until the bot edits its copy. */
export function getObservationTerrain(map: GameMap): GameMap | undefined {
  const terrain = observationTerrain.get(map);
  if (!terrain) return;

  return sameTerrain(map, terrain) ? terrain : undefined;
}

function sameTerrain(first: GameMap, second: GameMap): boolean {
  if (first === second) return true;

  const sameDimensions = first.width === second.width && first.height === second.height;
  if (!sameDimensions) return false;
  if (first.tiles.length !== second.tiles.length) return false;

  for (let y = 0; y < first.tiles.length; y++) {
    const row = first.tiles[y];
    const expected = second.tiles[y]!;
    const matches = row && sameRow(row, expected);
    if (!matches) return false;
  }

  return true;
}

function sameRow(first: GameMap["tiles"][number], second: GameMap["tiles"][number]): boolean {
  if (first.length !== second.length) return false;

  for (let x = 0; x < first.length; x++) {
    if (first[x] !== second[x]) return false;
  }

  return true;
}
