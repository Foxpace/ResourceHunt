import { mapCells, manhattanDistance } from "../grid.ts";
import { terrainCost, samePosition } from "../pathfinding.ts";
import { randomFromSeed } from "../random.ts";
import type { Biome, Position } from "../types.ts";
import { interruptBot, isSafeBase, recordWorldEvent } from "./shared.ts";
import {
  NATURAL_HAZARD_RADIUS,
  type HazardKind,
  type NaturalHazard,
  type WorldTurn,
} from "./types.ts";

const BIOME_HAZARDS: Record<Biome, HazardKind[]> = {
  riverlands: ["storm"],
  valley: ["storm"],
  desert: ["sandstorm"],
  moon: ["meteors"],
  volcanic: ["lava", "boulders"],
  archipelago: ["squall"],
  tundra: ["blizzard"],
  forest: ["storm", "wildfire"],
};

export class NaturalEventScheduler {
  private random: () => number;
  private nextAnnouncement = 32;
  private sequence = 0;

  constructor(seed: string) {
    this.random = randomFromSeed(`${seed}:weather`);
  }

  initialize(turn: WorldTurn): void {
    if (turn.context.config.naturalEvents) this.announceHazard(turn, 18);
  }

  advance(turn: WorldTurn): void {
    const { tick, config } = turn.context;
    turn.state.hazards = turn.state.hazards.filter((hazard) => hazard.endsAt > tick);
    if (!config.naturalEvents) return;
    if (tick >= this.nextAnnouncement) {
      this.announceHazard(turn, tick + 4);
      this.nextAnnouncement = tick + 32;
    }
    for (const hazard of turn.state.hazards) {
      if (hazard.startsAt === tick) impactHazard(turn, hazard);
    }
  }

  private announceHazard(turn: WorldTurn, startsAt: number): void {
    const candidates = [...mapCells(turn.context.map, 1)].filter((position) =>
      isHazardSite(turn, position),
    );
    if (!candidates.length) return;

    const center = candidates[Math.floor(this.random() * candidates.length)]!;
    const kinds = BIOME_HAZARDS[turn.context.config.biome];
    const kind = kinds[this.sequence++ % kinds.length]!;
    const cells = candidates.filter(
      (position) => manhattanDistance(position, center) <= NATURAL_HAZARD_RADIUS,
    );
    const hazard = {
      id: `hazard-${this.sequence}`,
      kind,
      center,
      cells,
      announcedAt: turn.context.tick,
      startsAt,
      endsAt: startsAt + 7,
    };
    turn.state.hazards.push(hazard);
    recordWorldEvent(turn, {
      message: `${kind} forecast · impact at tick ${startsAt}`,
      position: center,
      effect: "guard",
    });
  }
}

function isHazardSite(turn: WorldTurn, position: Position): boolean {
  const terrain = turn.context.map.tiles[position.y]![position.x];
  const passable = Number.isFinite(terrainCost(turn.context.map, position));
  const onDepot = turn.context.outposts.some((outpost) => samePosition(outpost, position));
  const onCache = turn.state.caches.some((cache) => samePosition(cache.position, position));
  const reserved = onDepot || onCache;
  const onBridge = terrain === "bridge";
  const insideSafeArea = isSafeBase(turn, position);
  const protectedSite = reserved || onBridge || insideSafeArea;

  return passable && !protectedSite;
}

function impactHazard(turn: WorldTurn, hazard: NaturalHazard): void {
  for (const bot of turn.context.bots) {
    if (!hazard.cells.some((cell) => samePosition(cell, bot.position))) continue;

    interruptBot(turn, bot);
  }
  recordWorldEvent(turn, {
    message: `${hazard.kind} impact · affected terrain clears at tick ${hazard.endsAt}`,
    position: hazard.center,
    effect: "impact",
  });
}
