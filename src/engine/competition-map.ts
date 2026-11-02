import { positionKey, samePosition, terrainCost, distanceField } from "./pathfinding.ts";
import { BIOMES } from "./biomes.ts";
import { randomFromSeed } from "./random.ts";
import type { GameConfig, GameMap, Hotspot, Outpost, Position, ResourcePile } from "./types.ts";

/** Seeded sites follow the generated terrain instead of fixed central coordinates. */
export function placeCompetitionSites(
  map: GameMap,
  config: GameConfig,
  protectedCells: Position[],
  bases: Position[],
) {
  const random = randomFromSeed(`${config.seed}:sites`);
  const reserved = new Set(protectedCells.map(positionKey));
  const chosen: Position[] = [];
  const candidates: (Position & { tie: number })[] = [];
  for (let y = 1; y < map.height - 1; y++)
    for (let x = 1; x < map.width - 1; x++) {
      const tile = map.tiles[y]![x];
      if (
        Number.isFinite(terrainCost(map, { x, y })) &&
        tile !== "bridge" &&
        !reserved.has(`${x},${y}`)
      )
        candidates.push({ x, y, tie: random() });
    }
  const cx = (map.width - 1) / 2,
    cy = (map.height - 1) / 2;
  function take(p: Position): Position {
    const result = { x: p.x, y: p.y };
    reserved.add(positionKey(result));
    chosen.push(result);
    return result;
  }
  function choose(target: Position): Position {
    const score = (p: Position & { tie: number }) => {
      const separation = chosen.reduce(
        (penalty, other) =>
          penalty + Math.max(0, 4 - Math.abs(p.x - other.x) - Math.abs(p.y - other.y)) * 8,
        0,
      );
      return Math.abs(p.x - target.x) + Math.abs(p.y - target.y) + separation + p.tie * 0.3;
    };
    const next = candidates
      .filter((p) => !reserved.has(positionKey(p)))
      .sort((a, b) => score(a) - score(b))[0];
    if (!next) throw new Error("Not enough land for competitive sites");
    return take(next);
  }
  const outposts: Outpost[] = Array.from({ length: config.outpostCount }, (_, index) => {
    const angle = -Math.PI / 2 + (index * Math.PI * 2) / config.outpostCount;
    const position = choose({
      x: cx + Math.cos(angle) * map.width * 0.2,
      y: cy + Math.sin(angle) * map.height * 0.23,
    });
    map.tiles[position.y]![position.x] = BIOMES[config.biome].spawnTerrain;
    return {
      ...position,
      id: `outpost-${index + 1}`,
      ownerId: null,
      capturingBotId: null,
      captureProgress: 0,
    };
  });
  const arrivals = new Map<string, number[]>();
  const playerArrivals = new Map<string, { player: number; cost: number }[]>();
  const servedPlayers = new Set<number>();
  if (config.resourceDensity > 0 && config.hotspotCount > 0) {
    for (const [player, base] of bases.entries())
      for (const [key, route] of distanceField(map, base)) {
        const costs = arrivals.get(key) ?? [];
        costs.push(route.cost);
        arrivals.set(key, costs);
        const players = playerArrivals.get(key) ?? [];
        players.push({ player, cost: route.cost });
        playerArrivals.set(key, players);
      }
    for (const costs of arrivals.values()) costs.sort((a, b) => a - b);
  }
  const nearestPlayers = (p: Position) =>
    [...playerArrivals.get(positionKey(p))!]
      .sort(
        (a, b) =>
          a.cost - b.cost ||
          Number(servedPlayers.has(a.player)) - Number(servedPlayers.has(b.player)),
      )
      .slice(0, 2);
  const hotspots: Hotspot[] = Array.from(
    { length: config.resourceDensity > 0 ? config.hotspotCount : 0 },
    (_, index) => {
      const features = (p: Position): number => {
        const tile = map.tiles[p.y]![p.x]!;
        const neighbors = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].map(([dx, dy]) => map.tiles[p.y + dy!]?.[p.x + dx!]);
        // Shores, passes, crater rims, and maze junctions make useful contested sites.
        const transitions = neighbors.filter((other) => other && other !== tile).length;
        const blocked = neighbors.filter(
          (other) =>
            other === "water" || other === "cliff" || other === "lava" || other === "thicket",
        ).length;
        return 1 + transitions * 0.4 + blocked * 0.5;
      };
      const available = candidates.filter((p) => !reserved.has(positionKey(p)));
      const awayFromBases = available.filter((p) => (arrivals.get(positionKey(p))?.[0] ?? 0) >= 5);
      const spread = awayFromBases.length ? awayFromBases : available;
      // Prefer sites with comparable travel times from at least two players.
      const contested = spread.filter((p) => {
        const times = arrivals.get(positionKey(p))!;
        return times.length < 2 || times[1]! - times[0]! <= Math.max(2, times[1]! * 0.35);
      });
      const eligible = contested.length ? contested : spread;
      const unserved = (p: Position) =>
        nearestPlayers(p).filter((item) => !servedPlayers.has(item.player)).length;
      const coverage = Math.max(0, ...eligible.map(unserved));
      const pool = eligible.filter((p) => unserved(p) === coverage);
      const weights = pool.map((p) => {
        const nearestSite = chosen.length
          ? Math.min(...chosen.map((site) => Math.abs(site.x - p.x) + Math.abs(site.y - p.y)))
          : map.width;
        const times = arrivals.get(positionKey(p))!;
        const gap = times.length > 1 ? times[1]! - times[0]! : 0;
        return (features(p) * Math.min(8, Math.max(0.1, nearestSite))) / (1 + gap * 0.25);
      });
      let roll = random() * weights.reduce((sum, weight) => sum + weight, 0);
      const target = pool.find((_, i) => (roll -= weights[i]!) <= 0) ?? pool.at(-1);
      if (!target) throw new Error("Not enough land for resource hotspots");
      for (const item of nearestPlayers(target)) servedPlayers.add(item.player);
      return {
        ...take(target),
        id: `hotspot-${index + 1}`,
        radius: 2,
      };
    },
  );
  return { hotspots, outposts };
}

/** Hotspots have finite, high-value supplies; normal opening resources stay untouched. */
export function stockHotspots(
  map: GameMap,
  config: GameConfig,
  hotspots: Hotspot[],
  outposts: Outpost[],
  protectedCells: Position[],
  resources: ResourcePile[],
): void {
  const random = randomFromSeed(`${config.seed}:hotspot-stock`);
  const reserved = new Set([...protectedCells, ...outposts].map(positionKey));
  const used = new Set<string>();
  for (const hotspot of hotspots) {
    const candidates: (Position & { distance: number; tie: number })[] = [];
    for (
      let y = Math.max(0, hotspot.y - hotspot.radius);
      y <= Math.min(map.height - 1, hotspot.y + hotspot.radius);
      y++
    ) {
      for (
        let x = Math.max(0, hotspot.x - hotspot.radius);
        x <= Math.min(map.width - 1, hotspot.x + hotspot.radius);
        x++
      ) {
        const distance = Math.abs(x - hotspot.x) + Math.abs(y - hotspot.y);
        const tile = map.tiles[y]![x];
        if (
          distance <= hotspot.radius &&
          Number.isFinite(terrainCost(map, { x, y })) &&
          tile !== "bridge" &&
          !reserved.has(`${x},${y}`) &&
          !hotspots.some((other) => other.id !== hotspot.id && other.x === x && other.y === y) &&
          !used.has(`${x},${y}`)
        )
          candidates.push({ x, y, distance, tie: random() });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.tie - b.tie);
    for (const [index, p] of candidates.slice(0, 5).entries()) {
      const existing = resources.findIndex((pile) => samePosition(pile, p));
      if (existing >= 0) resources.splice(existing, 1);
      used.add(positionKey(p));
      resources.push({
        x: p.x,
        y: p.y,
        kind: index % 2 === 0 ? "relic" : "crystal",
        amount: 2 + Math.floor(random() * 2),
        hotspotId: hotspot.id,
      });
    }
  }
}
