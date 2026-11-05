import {
  RESOURCES,
  TERRAIN_COST,
  type Direction,
  type GameMap,
  type Position,
  type ResourceKind,
} from "./types.ts";

export const DIRECTIONS: Record<Direction, Position> = {
  N: { x: 0, y: -1 },
  W: { x: -1, y: 0 },
  E: { x: 1, y: 0 },
  S: { x: 0, y: 1 },
};
export const samePosition = (first: Position, second: Position) =>
  first.x === second.x && first.y === second.y;
export const positionKey = (position: Position) => `${position.x},${position.y}`;
export const terrainCost = (map: GameMap, position: Position): number => {
  const terrain = map.tiles[position.y]?.[position.x];

  return terrain ? TERRAIN_COST[terrain] : Infinity;
};
export const inventoryWeight = (items: readonly ResourceKind[]) =>
  items.reduce((weight, kind) => weight + RESOURCES[kind].weight, 0);

export interface Route {
  cost: number;
  steps: Direction[];
}

/** Dijkstra search. Costs include entering the destination cell. Water is impassable. */
export function findPath(map: GameMap, from: Position, to: Position): Route | null {
  const routes = distanceField(map, from, to);

  return routes.get(positionKey(to)) ?? null;
}

/** One search for all targets, useful when comparing resource piles. */
export function distanceField(map: GameMap, from: Position, stopAt?: Position): Map<string, Route> {
  if (!Number.isFinite(terrainCost(map, from))) return new Map();

  return new RouteSearch(map, from).search(stopAt);
}

interface SearchNode {
  id: number;
  cost: number;
}

/** Minimum-cost queue preserves the original search's tie order. */
class RouteQueue {
  private nodes: SearchNode[] = [];
  get length() {
    return this.nodes.length;
  }

  push(node: SearchNode): void {
    let index = this.nodes.length;
    this.nodes.push(node);

    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.nodes[parent]!.cost <= node.cost) break;

      this.nodes[index] = this.nodes[parent]!;
      index = parent;
    }

    this.nodes[index] = node;
  }

  pop(): SearchNode {
    const first = this.nodes[0]!;
    const last = this.nodes.pop()!;
    if (this.nodes.length) this.restoreHeap(last);

    return first;
  }

  private restoreHeap(last: SearchNode): void {
    let index = 0;

    while (index * 2 + 1 < this.nodes.length) {
      let child = index * 2 + 1;

      const rightChildCheaper =
        child + 1 < this.nodes.length && this.nodes[child + 1]!.cost < this.nodes[child]!.cost;
      if (rightChildCheaper) child++;
      if (last.cost <= this.nodes[child]!.cost) break;

      this.nodes[index] = this.nodes[child]!;
      index = child;
    }

    this.nodes[index] = last;
  }
}

class RouteSearch {
  private costs: Float64Array;
  private previousCellIndices: Int32Array;
  private arrivalDirections: (Direction | undefined)[];
  private queue = new RouteQueue();
  private startingCellIndex: number;

  constructor(
    private map: GameMap,
    from: Position,
  ) {
    const size = map.width * map.height;
    this.costs = new Float64Array(size).fill(Infinity);
    this.previousCellIndices = new Int32Array(size).fill(-1);
    this.arrivalDirections = new Array(size);
    this.startingCellIndex = this.getCellIndex(from);
    this.costs[this.startingCellIndex] = 0;
    this.queue.push({ id: this.startingCellIndex, cost: 0 });
  }

  search(stopAt?: Position): Map<string, Route> {
    while (this.queue.length) {
      const node = this.queue.pop();
      if (node.cost !== this.costs[node.id]) continue;

      const position = this.getCellPosition(node.id);
      const targetReached = !!(stopAt && samePosition(position, stopAt));
      if (targetReached) break;

      this.visitNeighbors(node, position);
    }

    return this.collectRoutes();
  }

  private visitNeighbors(node: SearchNode, position: Position): void {
    for (const [direction, delta] of Object.entries(DIRECTIONS) as [Direction, Position][]) {
      const next = { x: position.x + delta.x, y: position.y + delta.y };
      const stepCost = terrainCost(this.map, next);
      if (!Number.isFinite(stepCost)) continue;

      const id = this.getCellIndex(next);
      const cost = node.cost + stepCost;
      if (cost >= this.costs[id]!) continue;

      this.costs[id] = cost;
      this.previousCellIndices[id] = node.id;
      this.arrivalDirections[id] = direction;
      this.queue.push({ id, cost });
    }
  }

  private collectRoutes(): Map<string, Route> {
    const result = new Map<string, Route>();

    for (let id = 0; id < this.costs.length; id++) {
      if (!Number.isFinite(this.costs[id])) continue;

      result.set(positionKey(this.getCellPosition(id)), {
        cost: this.costs[id]!,
        steps: this.retraceSteps(id),
      });
    }

    return result;
  }

  private retraceSteps(id: number): Direction[] {
    const steps: Direction[] = [];

    for (
      let current = id;
      current !== this.startingCellIndex;
      current = this.previousCellIndices[current]!
    )
      steps.push(this.arrivalDirections[current]!);

    return steps.reverse();
  }

  private getCellIndex(position: Position): number {
    return position.y * this.map.width + position.x;
  }
  private getCellPosition(id: number): Position {
    return { x: id % this.map.width, y: Math.floor(id / this.map.width) };
  }
}

export const inventoryValue = (items: readonly ResourceKind[]): number =>
  items.reduce((value, kind) => value + RESOURCES[kind].value, 0);
