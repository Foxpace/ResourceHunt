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
export const samePosition = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
export const positionKey = (p: Position) => `${p.x},${p.y}`;
export const terrainCost = (map: GameMap, p: Position): number => {
  const terrain = map.tiles[p.y]?.[p.x];
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
  const size = map.width * map.height;
  const costs = new Float64Array(size).fill(Infinity);
  const previous = new Int32Array(size).fill(-1);
  const moves: (Direction | undefined)[] = new Array(size);
  const index = (p: Position) => p.y * map.width + p.x;
  const start = index(from);
  if (!Number.isFinite(terrainCost(map, from))) return new Map();
  costs[start] = 0;
  // Binary heap keeps pathfinding practical for benchmark runs.
  const heap: { id: number; cost: number }[] = [];
  function push(node: { id: number; cost: number }) {
    let i = heap.length;
    heap.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (heap[parent]!.cost <= node.cost) break;
      heap[i] = heap[parent]!;
      i = parent;
    }
    heap[i] = node;
  }
  function pop() {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      let i = 0;
      while (i * 2 + 1 < heap.length) {
        let child = i * 2 + 1;
        if (child + 1 < heap.length && heap[child + 1]!.cost < heap[child]!.cost) child++;
        if (last.cost <= heap[child]!.cost) break;
        heap[i] = heap[child]!;
        i = child;
      }
      heap[i] = last;
    }
    return top;
  }
  push({ id: start, cost: 0 });
  while (heap.length) {
    const node = pop();
    if (node.cost !== costs[node.id]) continue;
    const p = { x: node.id % map.width, y: Math.floor(node.id / map.width) };
    if (stopAt && samePosition(p, stopAt)) break;
    for (const [direction, delta] of Object.entries(DIRECTIONS) as [Direction, Position][]) {
      const next = { x: p.x + delta.x, y: p.y + delta.y };
      const stepCost = terrainCost(map, next);
      if (!Number.isFinite(stepCost)) continue;
      const id = index(next);
      const cost = node.cost + stepCost;
      if (cost >= costs[id]!) continue;
      costs[id] = cost;
      previous[id] = node.id;
      moves[id] = direction;
      push({ id, cost });
    }
  }
  const result = new Map<string, Route>();
  for (let id = 0; id < size; id++) {
    if (!Number.isFinite(costs[id])) continue;
    const steps: Direction[] = [];
    for (let current = id; current !== start; current = previous[current]!) {
      steps.push(moves[current]!);
    }
    result.set(`${id % map.width},${Math.floor(id / map.width)}`, {
      cost: costs[id]!,
      steps: steps.reverse(),
    });
  }
  return result;
}
