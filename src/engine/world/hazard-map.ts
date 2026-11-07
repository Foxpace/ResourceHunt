import type { GameMap, Terrain } from "../types.ts";
import type { HazardKind, NaturalHazard, WorldState } from "./types.ts";

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
  return overlayHazards(map, activeHazards(world, tick));
}

/** The engine owns its hazard objects and only replaces them when the weather changes. */
export class HazardMapCache {
  private active: NaturalHazard[] = [];
  private current: GameMap;

  constructor(private base: GameMap) {
    this.current = base;
  }

  atTick(world: WorldState, tick: number): GameMap {
    const active = activeHazards(world, tick);
    const sameCount = this.active.length === active.length;
    const sameHazards = active.every((hazard, index) => hazard === this.active[index]);
    if (sameCount && sameHazards) return this.current;

    this.active = active;
    this.current = overlayHazards(this.base, active);
    return this.current;
  }
}

function activeHazards(world: WorldState, tick: number): NaturalHazard[] {
  return world.hazards.filter((hazard) => {
    const hasStarted = hazard.startsAt <= tick;
    const hasNotExpired = hazard.endsAt > tick;
    return hasStarted && hasNotExpired;
  });
}

function overlayHazards(map: GameMap, active: NaturalHazard[]): GameMap {
  if (!active.length) return map;

  const tiles = map.tiles.map((row) => [...row]);
  for (const hazard of active) {
    for (const cell of hazard.cells) tiles[cell.y]![cell.x] = HAZARD_TERRAIN[hazard.kind];
  }

  return { ...map, tiles };
}
