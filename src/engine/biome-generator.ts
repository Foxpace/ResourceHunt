import { archipelago, islandBases } from "./archipelago.ts";
import { clearStartingAreas } from "./starting-areas.ts";
import { BIOMES } from "./biomes.ts";
import { connectLand } from "./map-connectivity.ts";
import { generateRiver } from "./river.ts";
import type { Biome, GameConfig, GameMap, Position, Terrain } from "./types.ts";

interface Context {
  bases: Position[];
  width: number;
  height: number;
  roughness: number;
  random: () => number;
}
type Template = (context: Context) => Terrain[][];
const grid = (width: number, height: number, tile: (x: number, y: number) => Terrain) =>
  Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => tile(x, y)));

const riverlands: Template = ({ width, height, roughness, random }) =>
  grid(width, height, () => {
    const roll = random();
    return roll < roughness * 0.62 ? "forest" : roll < roughness ? "mountain" : "grass";
  });

const valley: Template = ({ width, height, roughness, random, bases }) => {
  const center = { x: (width - 1) / 2, y: (height - 1) / 2 };
  const phase = random() * Math.PI * 2;
  const floor = Math.max(0.65, Math.min(2, Math.min(width, height) / (bases.length * 2.5)));
  const branches = bases.map((base) => {
    const length = Math.hypot(base.x - center.x, base.y - center.y);
    return { x: (base.x - center.x) / length, y: (base.y - center.y) / length, length };
  });
  return grid(width, height, (x, y) => {
    const dx = x - center.x,
      dy = y - center.y;
    let distance = Infinity;
    for (const branch of branches) {
      const along = dx * branch.x + dy * branch.y;
      if (along < 0) continue;
      const wave =
        Math.sin((along / branch.length) * Math.PI) * Math.sin(along / 5 + phase) * floor * 0.5;
      distance = Math.min(distance, Math.abs(dx * -branch.y + dy * branch.x - wave));
    }
    if (Math.hypot(dx, dy) < floor * 2) return "grass";
    if (distance <= floor) return "grass";
    const pass = Math.abs(Math.sin(Math.hypot(dx, dy) / 4 + phase)) < 0.12;
    if (distance <= floor + 1.1) return pass ? "mountain" : "cliff";
    return random() < roughness ? "forest" : "mountain";
  });
};

interface Ellipse {
  x: number;
  y: number;
  rx: number;
  ry: number;
}
function ellipse(random: () => number, width: number, height: number, scale: number): Ellipse {
  return {
    x: (0.15 + random() * 0.7) * (width - 1),
    y: (0.15 + random() * 0.7) * (height - 1),
    rx: Math.max(2, width * scale * (0.7 + random() * 0.6)),
    ry: Math.max(2, height * scale * (0.7 + random() * 0.6)),
  };
}
const radius = (x: number, y: number, shape: Ellipse) =>
  Math.hypot((x - shape.x) / shape.rx, (y - shape.y) / shape.ry);

const desert: Template = ({ width, height, roughness, random, bases }) => {
  const phase = random() * Math.PI * 2;
  const mesas = Array.from({ length: 3 }, () => ellipse(random, width, height, 0.12));
  const oases = Array.from({ length: 2 }, () => ellipse(random, width, height, 0.09));
  return grid(width, height, (x, y) => {
    const startDistance = Math.min(...bases.map((base) => Math.hypot(x - base.x, y - base.y)));
    if (startDistance < 3.5) return "oasis";
    if (startDistance < 5) return "sand";
    if (oases.some((shape) => radius(x, y, shape) < 0.4)) return "water";
    if (oases.some((shape) => radius(x, y, shape) < 1)) return "oasis";
    if (mesas.some((shape) => radius(x, y, shape) < 0.6)) return "cliff";
    if (mesas.some((shape) => radius(x, y, shape) < 1)) return "mountain";
    return Math.sin(x * 0.65 + y * 0.33 + phase) > 0.65 - roughness ? "dune" : "sand";
  });
};

const moon: Template = ({ width, height, roughness, random, bases }) => {
  const size = Math.max(3.5, Math.min(width, height) * (0.17 + roughness * 0.03 + random() * 0.02));
  const craters = bases.map((base) => ({
    ...base,
    rx: size,
    ry: size,
    gate: Math.atan2((height - 1) / 2 - base.y, (width - 1) / 2 - base.x),
  }));
  return grid(width, height, (x, y) => {
    let tile: Terrain = "regolith";
    for (const crater of craters) {
      const r = radius(x, y, crater);
      if (r < 0.78) tile = "crater";
      else if (r < 1.15) {
        const angle = Math.atan2((y - crater.y) / crater.ry, (x - crater.x) / crater.rx);
        tile = Math.abs(Math.sin(angle - crater.gate)) < 0.28 ? "mountain" : "cliff";
      }
    }
    return tile;
  });
};

const volcanic: Template = ({ width, height, roughness, random, bases }) => {
  const phase = random() * Math.PI * 2;
  return grid(width, height, (x, y) => {
    const startDistance = Math.min(...bases.map((base) => Math.hypot(x - base.x, y - base.y)));
    if (startDistance < 3.5) return "basalt";
    if (startDistance < 4.5) return "ash";
    const dx = (x - (width - 1) / 2) / (width * 0.48),
      dy = (y - (height - 1) / 2) / (height * 0.48);
    const r = Math.hypot(dx, dy),
      angle = Math.atan2(dy, dx);
    const causeway = Math.abs(Math.sin(angle * 3 + phase)) < 0.18;
    if (r < 0.23 || (r > 0.5 && r < 0.66 && !causeway)) return "lava";
    if (r > 0.24 && r < 0.95 && Math.abs(Math.sin(angle * 3 + phase + 1)) < 0.12) return "lava";
    if (r < 0.32 || (r > 0.66 && r < 0.78)) return "mountain";
    return random() < roughness * 1.8 ? "ash" : "basalt";
  });
};

const tundra: Template = ({ width, height, roughness, random, bases }) => {
  const lake = { x: (width - 1) / 2, y: (height - 1) / 2, rx: width * 0.32, ry: height * 0.35 };
  const pools = Array.from({ length: 3 }, () => ellipse(random, width, height, 0.065));
  const phase = random() * Math.PI * 2;
  return grid(width, height, (x, y) => {
    const startDistance = Math.min(...bases.map((base) => Math.hypot(x - base.x, y - base.y)));
    if (startDistance < 3.5) return "ice";
    if (startDistance < 5) return "snow";
    if (pools.some((shape) => radius(x, y, shape) < 0.65)) return "water";
    if (radius(x, y, lake) < 1 || Math.abs(Math.sin(x * 0.13 + y * 0.26 + phase)) < 0.12)
      return "ice";
    return random() < roughness ? "mountain" : "snow";
  });
};

const forest: Template = ({ width, height, roughness, random }) => {
  const tiles = grid(width, height, () => "thicket");
  const stack: Position[] = [{ x: 1, y: 1 }];
  const seen = new Set(["1,1"]);
  tiles[1]![1] = "grass";
  while (stack.length) {
    const current = stack.at(-1)!;
    const next = [
      { x: 2, y: 0 },
      { x: -2, y: 0 },
      { x: 0, y: 2 },
      { x: 0, y: -2 },
    ]
      .map((delta) => ({ x: current.x + delta.x, y: current.y + delta.y }))
      .filter(
        (p) =>
          p.x > 0 && p.x < width - 1 && p.y > 0 && p.y < height - 1 && !seen.has(`${p.x},${p.y}`),
      );
    if (!next.length) {
      stack.pop();
      continue;
    }
    const destination = next[Math.floor(random() * next.length)]!;
    seen.add(`${destination.x},${destination.y}`);
    tiles[(current.y + destination.y) / 2]![(current.x + destination.x) / 2] = "grass";
    tiles[destination.y]![destination.x] = random() < roughness ? "forest" : "grass";
    stack.push(destination);
  }
  return tiles;
};

const templates: Record<Biome, Template> = {
  riverlands,
  valley,
  desert,
  moon,
  volcanic,
  archipelago: ({ width, height, bases, roughness, random }) =>
    archipelago(width, height, bases.length, roughness, random),
  tundra,
  forest,
};

export function generateBiome(
  config: GameConfig,
  proposedBases: Position[],
  random: () => number,
): { map: GameMap; bases: Position[]; openingCells: Position[] } {
  const map = {
    width: config.width,
    height: config.height,
    tiles: templates[config.biome]({
      bases: proposedBases,
      width: config.width,
      height: config.height,
      roughness: config.terrainDensity,
      random,
    }),
  };
  const bases = config.biome === "archipelago" ? islandBases(map, proposedBases) : proposedBases;
  const cy = (config.height - 1) / 2;
  const openingCells = bases.map((base) => ({ x: base.x, y: base.y + (base.y < cy ? 1 : -1) }));
  const spawn = BIOMES[config.biome].spawnTerrain;
  const clear = (p: Position) => {
    map.tiles[p.y]![p.x] = spawn;
  };
  for (const base of bases) {
    for (let y = base.y - 1; y <= base.y + 1; y++)
      for (let x = base.x - 1; x <= base.x + 1; x++) clear({ x, y });
    // Give every Riverlands base a clear approach before laying the river.
    if (config.biome === "riverlands") {
      const p = { ...base },
        center = { x: Math.round((map.width - 1) / 2), y: Math.round((map.height - 1) / 2) };
      while (p.x !== center.x) {
        p.x += Math.sign(center.x - p.x);
        clear(p);
      }
      while (p.y !== center.y) {
        p.y += Math.sign(center.y - p.y);
        clear(p);
      }
    }
  }
  const startingAreas = clearStartingAreas(map, bases, config.biome);
  if (config.biome === "riverlands") {
    try {
      generateRiver(map, startingAreas, random);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "Unable to route a river around the bases")
        throw error;
      generateRiver(map, [...bases, ...openingCells], random);
    }
  } else if (config.biome !== "archipelago") connectLand(map, bases[0]!, config.biome);
  return { map, bases, openingCells };
}
