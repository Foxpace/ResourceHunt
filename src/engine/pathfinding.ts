import { getObservationTerrain } from "./observation-terrain.ts";
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

function readDirectionOffsets() {
  return Object.entries(DIRECTIONS).map(([direction, { x, y }]) => ({
    direction: direction as Direction,
    x,
    y,
  }));
}

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

export interface OriginRoutes {
  costTo(destination: Position): number;
  routeTo(destination: Position): Route | null;
}

/** Dijkstra search. Costs include entering the destination cell. Water is impassable. */
export function findPath(map: GameMap, from: Position, to: Position): Route | null {
  const validStart = Number.isFinite(terrainCost(map, from));
  const validDestination = Number.isFinite(terrainCost(map, to));
  if (!validStart || !validDestination) return null;

  const destination = cellIndex(map, to);
  return searchFrom(map, from).findRoute(destination);
}

/** Share the origin search across a batch of cost and route queries. */
export function searchRoutesFrom(map: GameMap, from: Position): OriginRoutes | null {
  if (!Number.isFinite(terrainCost(map, from))) return null;

  const search = searchFrom(map, from);
  return {
    costTo(to: Position) {
      if (!Number.isFinite(terrainCost(map, to))) return Infinity;
      return search.discoverCost(cellIndex(map, to));
    },
    routeTo(to: Position) {
      if (!Number.isFinite(terrainCost(map, to))) return null;
      return search.findRoute(cellIndex(map, to));
    },
  };
}

/** Reuse a search from the destination for callers that only need travel costs. */
export function travelCostsTo(map: GameMap, to: Position, origins: readonly Position[]): number[] {
  const directionsSymmetric = hasSymmetricDirections();
  const reverseCostsExact = hasExactReverseCosts(map);
  if (!directionsSymmetric || !reverseCostsExact) {
    return origins.map((origin) => findPath(map, origin, to)?.cost ?? Infinity);
  }

  const destinationCost = terrainCost(map, to);
  if (!Number.isFinite(destinationCost)) return origins.map(() => Infinity);

  const search = searchFrom(map, to);
  return origins.map((origin) => {
    const originCost = terrainCost(map, origin);
    if (!Number.isFinite(originCost)) return Infinity;

    // The two directions share all interior terrain costs and exchange their endpoints.
    const reverseCost = search.discoverCost(cellIndex(map, origin));
    return reverseCost + destinationCost - originCost;
  });
}

function hasExactReverseCosts(map: GameMap): boolean {
  const limit = Number.MAX_SAFE_INTEGER / (map.width * map.height + 1);
  return Object.values(TERRAIN_COST).every((cost) => {
    const blocked = cost === Infinity;
    const integer = Number.isSafeInteger(cost);
    const inRange = cost >= 0 && cost <= limit;
    return blocked || (integer && inRange);
  });
}

function hasSymmetricDirections(): boolean {
  const directions = Object.values(DIRECTIONS);

  return directions.every(({ x, y }) => {
    const reverse = { x: -x, y: -y };
    return directions.some((direction) => samePosition(direction, reverse));
  });
}

/** Find the cheapest reachable target. Equal costs favor the first supplied target. */
export function findNearestRoute<Target extends Position>(
  map: GameMap,
  from: Position,
  targets: readonly Target[],
): { target: Target; route: Route } | null {
  if (targets.length === 1) {
    const target = targets[0]!;
    const route = findPath(map, from, target);
    return route ? { target, route } : null;
  }
  if (!Number.isFinite(terrainCost(map, from))) return null;

  const candidates = new Map<number, Target>();
  for (const target of targets) {
    if (!Number.isFinite(terrainCost(map, target))) continue;

    const cell = cellIndex(map, target);
    if (!candidates.has(cell)) candidates.set(cell, target);
  }
  if (!candidates.size) return null;

  const search = searchFrom(map, from);
  const cell = search.findNearest(candidates);
  if (cell === undefined) return null;

  return { target: candidates.get(cell)!, route: search.routeTo(cell)! };
}

/** One search for all targets, useful when comparing resource piles. */
export function distanceField(map: GameMap, from: Position, stopAt?: Position): Map<string, Route> {
  if (!Number.isFinite(terrainCost(map, from))) return new Map();

  const reachableStop = stopAt !== undefined && Number.isFinite(terrainCost(map, stopAt));
  const destination = reachableStop ? cellIndex(map, stopAt) : undefined;
  // A stopped field exposes only the cells discovered by that exact point in the search.
  const search = destination === undefined ? searchFrom(map, from) : new RouteSearch(map, from);

  return search.collectRoutes(destination);
}

/** Row-major costs to every cell, with Infinity for unreachable cells. */
export function travelCostField(map: GameMap, from: Position): Float64Array {
  if (!Number.isFinite(terrainCost(map, from)))
    return new Float64Array(map.width * map.height).fill(Infinity);

  return new RouteSearch(map, from).costField();
}

export function cellIndex(map: GameMap, position: Position): number {
  return position.y * map.width + position.x;
}

const routeCaches = new WeakMap<GameMap, RouteCache>();
const MAX_CACHED_ORIGINS = 32;

function searchFrom(map: GameMap, from: Position): RouteSearch {
  const terrain = getObservationTerrain(map);
  if (!terrain) return new RouteSearch(map, from);

  let cache = routeCaches.get(terrain);
  if (!cache) {
    cache = new RouteCache(terrain);
    routeCaches.set(terrain, cache);
  }

  return cache.matchesRules() ? cache.search(from) : new RouteSearch(map, from);
}

class RouteCache {
  private searches = new Map<number, RouteSearch>();
  private costs = Object.entries(TERRAIN_COST) as [keyof typeof TERRAIN_COST, number][];
  private directions = readDirectionOffsets();

  constructor(private terrain: GameMap) {}

  matchesRules(): boolean {
    const keys = Object.keys(DIRECTIONS);
    if (keys.length !== this.directions.length) return false;

    const sameCosts = this.costs.every(([kind, cost]) => TERRAIN_COST[kind] === cost);
    const sameDirections = this.directions.every((expected, index) => {
      const sameKey = keys[index] === expected.direction;
      const current = DIRECTIONS[expected.direction];
      const sameOffset = current && samePosition(current, expected);
      return sameKey && sameOffset;
    });

    return sameCosts && sameDirections;
  }

  search(from: Position): RouteSearch {
    const start = cellIndex(this.terrain, from);
    const search = this.searches.get(start) ?? new RouteSearch(this.terrain, from, this.directions);
    this.searches.delete(start);
    this.searches.set(start, search);

    if (this.searches.size > MAX_CACHED_ORIGINS) {
      this.searches.delete(this.searches.keys().next().value!);
    }

    return search;
  }
}

/** Minimum-cost queue preserves the original search's tie order. */
class RouteQueue {
  private cells: number[] = [];

  constructor(private costs: Float64Array) {}

  get length() {
    return this.cells.length;
  }

  peek(): number {
    return this.cells[0]!;
  }

  push(cell: number): void {
    let index = this.cells.length;
    const cost = this.costs[cell]!;
    this.cells.push(cell);

    while (index > 0) {
      const parent = (index - 1) >> 1;
      const parentCell = this.cells[parent]!;
      if (this.costs[parentCell]! <= cost) break;

      this.cells[index] = parentCell;
      index = parent;
    }

    this.cells[index] = cell;
  }

  pop(): number {
    const first = this.cells[0]!;
    const last = this.cells.pop()!;
    if (this.cells.length) this.restoreHeap(last);

    return first;
  }

  private restoreHeap(last: number): void {
    let index = 0;
    const lastCost = this.costs[last]!;

    while (index * 2 + 1 < this.cells.length) {
      let child = index * 2 + 1;
      const leftCost = this.costs[this.cells[child]!]!;
      const rightCost = this.costs[this.cells[child + 1]!] ?? Infinity;

      if (rightCost < leftCost) child++;
      if (lastCost <= this.costs[this.cells[child]!]!) break;

      this.cells[index] = this.cells[child]!;
      index = child;
    }

    this.cells[index] = last;
  }
}

class RouteSearch {
  private costs: Float64Array;
  private previousCellIndices: Int32Array;
  private arrivalDirections: (Direction | undefined)[];
  private stepCounts: Uint32Array;
  private queue: RouteQueue;
  private startingCellIndex: number;

  constructor(
    private map: GameMap,
    from: Position,
    private directions = readDirectionOffsets(),
  ) {
    const size = map.width * map.height;
    this.costs = new Float64Array(size).fill(Infinity);
    this.queue = new RouteQueue(this.costs);
    this.previousCellIndices = new Int32Array(size).fill(-1);
    this.arrivalDirections = new Array(size);
    this.stepCounts = new Uint32Array(size);
    this.startingCellIndex = cellIndex(map, from);
    this.costs[this.startingCellIndex] = 0;
    this.queue.push(this.startingCellIndex);
  }

  private visitUntil(destination?: number): void {
    while (this.queue.length) {
      const cell = this.queue.pop();
      if (cell === destination) break;

      this.visitNeighbors(cell);
    }
  }

  findRoute(destination: number): Route | null {
    this.discoverCost(destination);
    return this.routeTo(destination);
  }

  discoverCost(destination: number): number {
    while (this.queue.length && this.costs[destination] === Infinity) {
      this.visitNeighbors(this.queue.pop());
    }

    return this.costs[destination]!;
  }

  findNearest(targets: ReadonlyMap<number, Position>): number | undefined {
    let cheapest = Infinity;
    for (const cell of targets.keys()) cheapest = Math.min(cheapest, this.costs[cell]!);

    // Include every cell at the winning cost, then apply the caller's target order.
    while (this.queue.length) {
      const cell = this.queue.peek();
      const cost = this.costs[cell]!;
      if (cost > cheapest) break;
      if (targets.has(cell)) cheapest = cost;

      this.visitNeighbors(this.queue.pop());
    }

    let best: number | undefined;
    cheapest = Infinity;
    for (const cell of targets.keys()) {
      const cost = this.costs[cell]!;
      if (cost >= cheapest) continue;

      cheapest = cost;
      best = cell;
    }

    return best;
  }

  private visitNeighbors(cell: number): void {
    const { width, tiles } = this.map;
    const x = cell % width;
    const y = Math.floor(cell / width);
    const cost = this.costs[cell]!;

    for (let index = 0; index < this.directions.length; index++) {
      const offset = this.directions[index]!;
      const nextX = x + offset.x;
      const nextY = y + offset.y;
      const nextCell = nextY * width + nextX;

      // All approaches pay the same entry cost. The first popped neighbor is cheapest.
      if (this.costs[nextCell] !== Infinity) continue;

      const terrain = tiles[nextY]?.[nextX];
      const stepCost = terrain ? TERRAIN_COST[terrain] : Infinity;
      if (!Number.isFinite(stepCost)) continue;

      this.costs[nextCell] = cost + stepCost;
      this.previousCellIndices[nextCell] = cell;
      this.arrivalDirections[nextCell] = offset.direction;
      this.stepCounts[nextCell] = this.stepCounts[cell]! + 1;
      this.queue.push(nextCell);
    }
  }

  routeTo(id: number): Route | null {
    const cost = this.costs[id]!;
    if (!Number.isFinite(cost)) return null;

    return { cost, steps: this.retraceSteps(id) };
  }

  collectRoutes(stopAt?: number): Map<string, Route> {
    this.visitUntil(stopAt);
    const result = new Map<string, Route>();
    const { width } = this.map;

    for (let id = 0; id < this.costs.length; id++) {
      const route = this.routeTo(id);
      if (!route) continue;

      const key = `${id % width},${Math.floor(id / width)}`;
      result.set(key, route);
    }

    return result;
  }

  costField(): Float64Array {
    this.visitUntil();
    return this.costs;
  }

  private retraceSteps(id: number): Direction[] {
    let index = this.stepCounts[id]!;
    const steps: Direction[] = new Array(index);

    for (
      let current = id;
      current !== this.startingCellIndex;
      current = this.previousCellIndices[current]!
    )
      steps[--index] = this.arrivalDirections[current]!;

    return steps;
  }
}

export const inventoryValue = (items: readonly ResourceKind[]): number =>
  items.reduce((value, kind) => value + RESOURCES[kind].value, 0);
