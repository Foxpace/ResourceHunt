import type { GameMap, Position, Terrain } from "./types.ts";

interface Band {
  start: number;
  end: number;
  lanes: number[];
}

function bands(size: number, count: number, gap: number): Band[] {
  const land = size - (count - 1) * gap;
  const widths = Array.from({ length: count }, () => Math.floor(land / count));
  let remaining = land % count;
  if (count % 2 && remaining % 2) {
    widths[Math.floor(count / 2)]!++;
    remaining--;
  }
  for (let i = Math.floor(count / 2) - 1; i >= 0 && remaining >= 2; i--) {
    widths[i]!++;
    widths[count - 1 - i]!++;
    remaining -= 2;
  }
  if (remaining) widths[Math.floor(count / 2)]!++;
  let start = 0;
  const result = widths.map((width) => {
    const end = start + width - 1;
    const middle = (start + end) / 2;
    const result = { start, end, lanes: [Math.floor(middle)] };
    start = end + gap + 1;
    return result;
  });
  for (let i = 0; i < Math.floor(count / 2); i++) {
    const opposite = result[count - 1 - i]!;
    const reflected = size - 1 - result[i]!.lanes[0]!;
    if (reflected >= opposite.start && reflected <= opposite.end) opposite.lanes = [reflected];
  }
  return result;
}

/** Equal-length crossings are planned before bases; no random shortest-path bridges. */
export function archipelago(
  width: number,
  height: number,
  playerCount: number,
  roughness: number,
  random: () => number,
): Terrain[][] {
  const count = Math.max(3, Math.ceil(playerCount / 4) + 1);
  let gap = Math.max(
    1,
    Math.min(3, Math.floor((Math.min(width, height) - count * 3) / (count - 1))),
  );
  if (count % 2 === 0 && width % 2 === 1 && height % 2 === 1 && gap % 2 === 0) gap--;
  const columns = bands(width, count, gap),
    rows = bands(height, count, gap);
  const samples = Array.from({ length: height }, () => Array.from({ length: width }, random));
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x): Terrain => {
      const column = columns.find((b) => x >= b.start && x <= b.end);
      const row = rows.find((b) => y >= b.start && y <= b.end);
      const laneX = columns.some((b) => b.lanes.includes(x));
      const laneY = rows.some((b) => b.lanes.includes(y));
      if (!column || !row)
        return (!column && row && laneY) || (!row && column && laneX) ? "bridge" : "water";
      if (laneX || laneY) return "grass";
      const roll = samples[Math.min(y, height - 1 - y)]![Math.min(x, width - 1 - x)]!;
      return roll < roughness * 0.3 ? "mountain" : roll < roughness ? "forest" : "grass";
    }),
  );
}

/** Keep starting clearings on islands so they cannot shorten an existing crossing. */
export function islandBases(map: GameMap, proposed: Position[]): Position[] {
  const bridges: Position[] = [];
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) if (map.tiles[y]![x] === "bridge") bridges.push({ x, y });
  const candidates: Position[] = [];
  for (let y = 1; y < map.height - 1; y++)
    for (let x = 1; x < map.width - 1; x++) {
      let land = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const tile = map.tiles[y + dy]![x + dx];
          if (tile === "water" || tile === "bridge") land = false;
        }
      if (land && bridges.some((bridge) => Math.abs(bridge.x - x) + Math.abs(bridge.y - y) === 2))
        candidates.push({ x, y });
    }
  const chosen: Position[] = [];
  for (const base of proposed) {
    const available = candidates.filter(
      (p) => !chosen.some((other) => Math.abs(other.x - p.x) + Math.abs(other.y - p.y) < 3),
    );
    available.sort((a, b) => {
      const distance = (p: Position) => Math.abs(p.x - base.x) + Math.abs(p.y - base.y);
      const outward = (p: Position) =>
        (p.x - base.x) * (base.x - (map.width - 1) / 2) +
        (p.y - base.y) * (base.y - (map.height - 1) / 2);
      return distance(a) - distance(b) || outward(b) - outward(a);
    });
    if (!available[0])
      throw new Error("Map is too small for this many island bases; increase its dimensions");
    chosen.push({ ...available[0] });
  }
  return chosen;
}
