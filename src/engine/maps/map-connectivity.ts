import type { BiomeConnectionContext } from "./generation-models.ts";
import { BIOMES } from "../biomes.ts";
import { DIRECTIONS, terrainCost } from "../pathfinding.ts";
import type { Biome, GameMap, Position } from "../types.ts";

/** Join disconnected land with shortest blocked crossings, preserving the template. */
export function connectLand(map: GameMap, origin: Position, biome: Biome): void {
  new LandConnector(map, origin, biome).connectLandRegions();
}

class LandConnector {
  constructor(
    private map: GameMap,
    private origin: Position,
    private biome: Biome,
  ) {}

  connectLandRegions(): void {
    while (true) {
      const crossing = this.findCrossing(this.floodLand());
      if (!crossing) return;

      this.carveCrossing(crossing.target, crossing.previous);
    }
  }

  private getNeighborCellIndices(id: number): number[] {
    const { width, height } = this.map;

    return Object.values(DIRECTIONS)
      .map((delta) => ({ x: (id % width) + delta.x, y: Math.floor(id / width) + delta.y }))
      .filter((position) => {
        const withinColumns = position.x >= 0 && position.x < width;
        const withinRows = position.y >= 0 && position.y < height;
        return withinColumns && withinRows;
      })
      .map((position) => position.y * width + position.x);
  }

  private isCellPassable(id: number): boolean {
    return Number.isFinite(
      terrainCost(this.map, { x: id % this.map.width, y: Math.floor(id / this.map.width) }),
    );
  }

  private floodLand(): Set<number> {
    const start = this.origin.y * this.map.width + this.origin.x;
    const seen = new Set([start]);
    const queue = [start];

    for (let head = 0; head < queue.length; head++)
      this.enqueueConnectedNeighbors(queue[head]!, seen, queue);

    return seen;
  }

  private enqueueConnectedNeighbors(current: number, seen: Set<number>, queue: number[]): void {
    for (const next of this.getNeighborCellIndices(current)) {
      const unvisitedLand = !seen.has(next) && this.isCellPassable(next);
      if (unvisitedLand) {
        seen.add(next);
        queue.push(next);
      }
    }
  }

  private findCrossing(connected: Set<number>): { target: number; previous: Int32Array } | null {
    const previous = new Int32Array(this.map.width * this.map.height).fill(-2);
    const queue = [...connected];

    for (const id of queue) previous[id] = -1;

    for (let head = 0; head < queue.length; head++) {
      const target = this.visitCrossingNeighbors(queue[head]!, previous, queue);
      if (target >= 0) return { target, previous };
    }

    return null;
  }

  private visitCrossingNeighbors(current: number, previous: Int32Array, queue: number[]): number {
    for (const next of this.getNeighborCellIndices(current)) {
      if (previous[next] !== -2) continue;

      previous[next] = current;
      if (this.isCellPassable(next)) return next;

      queue.push(next);
    }

    return -1;
  }

  private carveCrossing(target: number, previous: Int32Array): void {
    for (let id = target; previous[id]! >= 0; id = previous[id]!) {
      if (this.isCellPassable(id)) continue;

      const x = id % this.map.width,
        y = Math.floor(id / this.map.width);
      const tile = this.map.tiles[y]![x]!;
      this.map.tiles[y]![x] =
        tile === "water"
          ? BIOMES[this.biome].connectorTerrain
          : this.biome === "desert"
            ? "sand"
            : BIOMES[this.biome].spawnTerrain;
    }
  }
}

export function connectGeneratedLand(context: BiomeConnectionContext): void {
  const { map, bases, biome } = context;

  connectLand(map, bases[0]!, biome);
}
