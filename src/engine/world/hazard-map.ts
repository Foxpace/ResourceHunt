import type { GameMap, Terrain } from "../types.ts";
import type { HazardKind, WorldState } from "./types.ts";

const HAZARD_TERRAIN: Record<HazardKind, Terrain> = {
  lava: "lava",
  boulders: "mountain",
  meteors: "crater",
  storm: "forest",
  sandstorm: "dune",
  squall: "forest",
  blizzard: "snow",
  wildfire: "ash",
};

/** Temporary terrain overlays leave the generated map intact for expiry and replay seeking. */
export function getHazardMap(map: GameMap, world: WorldState, tick: number): GameMap {
  const active = world.hazards.filter((hazard) => {
    const hasStarted = hazard.startsAt <= tick;
    const hasNotExpired = hazard.endsAt > tick;
    return hasStarted && hasNotExpired;
  });
  if (!active.length) return map;

  const tiles = map.tiles.map((row) => [...row]);
  for (const hazard of active) {
    for (const cell of hazard.cells) tiles[cell.y]![cell.x] = HAZARD_TERRAIN[hazard.kind];
  }

  return { ...map, tiles };
}
