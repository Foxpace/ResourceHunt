import { positionKey } from "./pathfinding.ts";
import type { GameMap, Position } from "./types.ts";

interface Channel {
  left: number;
  right: number;
}

interface Segment {
  firstRow: number;
  lastRow: number;
  bridgeRow?: number;
  channels: Channel[];
  desiredCenter: number;
  desiredWidth: number;
}

/** A connected channel with straight, bank-to-bank crossings and protected spawn cells. */
export function generateRiver(
  map: GameMap,
  protectedCells: Position[],
  random: () => number,
): void {
  const protectedKeys = new Set(protectedCells.map(positionKey));
  const maxWidth = Math.min(5, Math.max(3, Math.round(map.width / 8)));
  const bendPhase = random() * Math.PI * 2;
  const widthPhase = random() * Math.PI * 2;
  const segments: Segment[] = [];

  for (let row = 0; row < map.height;) {
    // A crossing occupies the middle row of a straight three-row stretch.
    // This leaves visible water above and below every tile of its deck.
    const crossing = row % 6 === 2 && row + 2 < map.height;
    const lastRow = crossing ? row + 2 : row;
    const channels: Channel[] = [];
    for (let width = 2; width <= maxWidth; width++) {
      for (let left = 1; left + width < map.width; left++) {
        const right = left + width - 1;
        let blocked = false;
        for (let y = row; y <= lastRow && !blocked; y++) {
          for (let x = left; x <= right; x++) {
            if (protectedKeys.has(`${x},${y}`)) {
              blocked = true;
              break;
            }
          }
        }
        if (!blocked) channels.push({ left, right });
      }
    }
    const middleRow = (row + lastRow) / 2;
    segments.push({
      firstRow: row,
      lastRow,
      bridgeRow: crossing ? row + 1 : undefined,
      channels,
      desiredCenter: (map.width - 1) / 2 + Math.sin(middleRow / 6 + bendPhase) * map.width * 0.1,
      desiredWidth:
        2 + Math.round((maxWidth - 2) * (0.5 + Math.sin(middleRow / 4 + widthPhase) * 0.5)),
    });
    row = lastRow + 1;
  }

  const channel = planChannel(segments);
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const { left, right } = channel[index]!;
    for (let y = segment.firstRow; y <= segment.lastRow; y++) {
      for (let x = left; x <= right; x++) {
        map.tiles[y]![x] = y === segment.bridgeRow ? "bridge" : "water";
      }
    }
  }
}

/** Plan the whole river so avoiding a base cannot create a disconnected bend later. */
function planChannel(segments: Segment[]): Channel[] {
  const costs: number[][] = [];
  const parents: number[][] = [];
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    const previous = segments[index - 1];
    const rowCosts = segment.channels.map(() => Infinity);
    const rowParents = segment.channels.map(() => -1);
    for (let current = 0; current < segment.channels.length; current++) {
      const channel = segment.channels[current]!;
      const center = (channel.left + channel.right) / 2;
      const width = channel.right - channel.left + 1;
      const preference =
        Math.abs(center - segment.desiredCenter) + Math.abs(width - segment.desiredWidth) * 3;
      if (!previous) {
        rowCosts[current] = preference;
        continue;
      }

      for (let candidate = 0; candidate < previous.channels.length; candidate++) {
        const last = previous.channels[candidate]!;
        // Shared columns keep the water connected in four cardinal directions.
        if (last.right < channel.left || channel.right < last.left) continue;
        const bend = Math.abs(last.left - channel.left) + Math.abs(last.right - channel.right);
        const cost = costs[index - 1]![candidate]! + preference + bend * 2;
        if (cost < rowCosts[current]!) {
          rowCosts[current] = cost;
          rowParents[current] = candidate;
        }
      }
    }
    costs.push(rowCosts);
    parents.push(rowParents);
  }

  const finalCosts = costs.at(-1)!;
  let selected = finalCosts.indexOf(Math.min(...finalCosts));
  if (selected < 0 || !Number.isFinite(finalCosts[selected])) {
    throw new Error("Unable to route a river around the bases");
  }
  const result: Channel[] = new Array(segments.length);
  for (let index = segments.length - 1; index >= 0; index--) {
    result[index] = segments[index]!.channels[selected]!;
    selected = parents[index]![selected]!;
  }
  return result;
}
