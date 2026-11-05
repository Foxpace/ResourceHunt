import type { BiomeTemplate, BiomeTemplateContext } from "../generation-models.ts";
import { manhattanDistance, mapCells, cellsInRectangle } from "../../grid.ts";
import type { GameMap, Position, Terrain } from "../../types.ts";

interface Band {
  start: number;
  end: number;
  lanes: number[];
}

function createIslandBands(size: number, count: number, gap: number): Band[] {
  const widths = calculateIslandBandWidths(size, count, gap);

  let start = 0;
  const result = widths.map((width) => {
    const end = start + width - 1;
    const middle = (start + end) / 2;
    const result = { start, end, lanes: [Math.floor(middle)] };
    start = end + gap + 1;

    return result;
  });
  reflectCrossingLanes(result, size);

  return result;
}

/** Equal-length crossings are planned before bases; no random shortest-path bridges. */
function generateArchipelagoTerrain(context: BiomeTemplateContext): Terrain[][] {
  const { width, height, roughness, random, bases } = context;
  const count = Math.max(3, Math.ceil(bases.length / 4) + 1);
  const gap = calculateCrossingGap(width, height, count);
  const columns = createIslandBands(width, count, gap),
    rows = createIslandBands(height, count, gap);
  const samples = Array.from({ length: height }, () => Array.from({ length: width }, random));

  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x): Terrain => {
      const column = findIslandBand(columns, x);
      const row = findIslandBand(rows, y);
      const laneX = columns.some((islandBand) => islandBand.lanes.includes(x));
      const laneY = rows.some((islandBand) => islandBand.lanes.includes(y));

      const outsideIsland = !column || !row;
      if (outsideIsland) {
        return isIslandCrossing({ column, row }, { laneX, laneY }) ? "bridge" : "water";
      }

      const onCrossingLane = laneX || laneY;
      if (onCrossingLane) return "grass";

      const roll = samples[Math.min(y, height - 1 - y)]![Math.min(x, width - 1 - x)]!;

      return roll < roughness * 0.3 ? "mountain" : roll < roughness ? "forest" : "grass";
    }),
  );
}

function isIslandCrossing(
  bands: { column: Band | undefined; row: Band | undefined },
  lanes: { laneX: boolean; laneY: boolean },
): boolean {
  const insideColumnBand = !!bands.column;
  const insideRowBand = !!bands.row;
  const horizontalLane = lanes.laneY;
  const verticalLane = lanes.laneX;
  const horizontalCrossing = !insideColumnBand && insideRowBand && horizontalLane;
  const verticalCrossing = !insideRowBand && insideColumnBand && verticalLane;

  return horizontalCrossing || verticalCrossing;
}

function findIslandBand(bands: Band[], coordinate: number): Band | undefined {
  return bands.find((band) => {
    const afterStart = coordinate >= band.start;
    const beforeEnd = coordinate <= band.end;

    return afterStart && beforeEnd;
  });
}

/** Keep starting clearings on islands so they cannot shorten an existing crossing. */
function selectArchipelagoBases(map: GameMap, proposed: Position[]): Position[] {
  const bridges: Position[] = [];

  for (const position of mapCells(map))
    if (map.tiles[position.y]![position.x] === "bridge") bridges.push(position);

  const candidates = [...mapCells(map, 1)].filter((position) =>
    canPlaceIslandBase(map, bridges, position),
  );
  const chosen: Position[] = [];

  for (const base of proposed) {
    const available = candidates.filter(
      (position) => !chosen.some((other) => manhattanDistance(other, position) < 3),
    );
    chosen.push(chooseIslandBase(map, base, available));
  }

  return chosen;
}

function canPlaceIslandBase(map: GameMap, bridges: Position[], position: Position): boolean {
  const { x, y } = position;

  for (const neighbor of cellsInRectangle({
    left: x - 1,
    top: y - 1,
    right: x + 1,
    bottom: y + 1,
  })) {
    const tile = map.tiles[neighbor.y]![neighbor.x];

    const waterLane = tile === "water" || tile === "bridge";
    if (waterLane) return false;
  }

  return bridges.some((bridge) => manhattanDistance(bridge, { x, y }) === 2);
}

function reflectCrossingLanes(result: Band[], size: number): void {
  const count = result.length;

  for (let index = 0; index < Math.floor(count / 2); index++) {
    const opposite = result[count - 1 - index]!;
    const reflected = size - 1 - result[index]!.lanes[0]!;

    const reflectionFitsBand = reflected >= opposite.start && reflected <= opposite.end;
    if (reflectionFitsBand) opposite.lanes = [reflected];
  }
}

function calculateCrossingGap(width: number, height: number, count: number): number {
  let gap = Math.max(
    1,
    Math.min(3, Math.floor((Math.min(width, height) - count * 3) / (count - 1))),
  );
  const evenBandCount = count % 2 === 0;

  const oddMapDimensions = width % 2 === 1 && height % 2 === 1;
  const evenGap = gap % 2 === 0;
  if (evenBandCount && oddMapDimensions && evenGap) gap--;

  return gap;
}

function calculateIslandBandWidths(size: number, count: number, gap: number): number[] {
  const land = size - (count - 1) * gap;
  const widths = Array.from({ length: count }, () => Math.floor(land / count));
  let remaining = land % count;
  const oddCenterRemainder = !!(count % 2 && remaining % 2);
  if (oddCenterRemainder) {
    widths[Math.floor(count / 2)]!++;
    remaining--;
  }

  for (let index = Math.floor(count / 2) - 1; index >= 0; index--) {
    const canWidenPair = remaining >= 2;
    if (!canWidenPair) break;

    widths[index]!++;
    widths[count - 1 - index]!++;
    remaining -= 2;
  }

  if (remaining) widths[Math.floor(count / 2)]!++;

  return widths;
}

function chooseIslandBase(map: GameMap, base: Position, available: Position[]): Position {
  available.sort((first, second) => {
    const distance = (position: Position) => manhattanDistance(position, base);
    const outward = (position: Position) =>
      (position.x - base.x) * (base.x - (map.width - 1) / 2) +
      (position.y - base.y) * (base.y - (map.height - 1) / 2);

    return distance(first) - distance(second) || outward(second) - outward(first);
  });
  if (!available[0])
    throw new Error("Map is too small for this many island bases; increase its dimensions");

  return { ...available[0] };
}

export const archipelago: BiomeTemplate = {
  generateTerrain: generateArchipelagoTerrain,
  selectBases: selectArchipelagoBases,
  connectTerrain() {
    // Terrain generation already connects islands with planned, equal-length crossings.
  },
};
