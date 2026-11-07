import { type CellBounds, cellsInRectangle } from "../grid.ts";
import { positionKey } from "../pathfinding.ts";
import type { GameMap, Position } from "../types.ts";

interface Channel {
  left: number;
  right: number;
}

interface RowSpan {
  firstRow: number;
  lastRow: number;
}

interface Segment extends RowSpan {
  bridgeRow?: number;
  channels: Channel[];
  desiredCenter: number;
  desiredWidth: number;
}

interface RiverRoutingContext {
  map: GameMap;
  protectedKeys: Set<string>;
  maxWidth: number;
}

interface SegmentScores {
  segment: Segment;
  costs: number[];
  parents: number[];
}

interface ChannelParent {
  cost: number;
  parent: number;
}

/** A connected channel with straight, bank-to-bank crossings and protected spawn cells. */
export function generateRiver(
  map: GameMap,
  protectedCells: Position[],
  random: () => number,
): void {
  const segments = createRiverSegments(map, protectedCells, random);

  const channel = planChannel(segments);

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]!;
    paintRiverSegment(map, segment, channel[index]!);
  }
}

/** Plan the whole river so avoiding a base cannot create a disconnected bend later. */
function planChannel(segments: Segment[]): Channel[] {
  const scores: SegmentScores[] = [];

  for (const segment of segments) scores.push(scoreSegmentChannels(segment, scores.at(-1)));

  const finalCosts = scores.at(-1)!.costs;
  let selected = finalCosts.indexOf(Math.min(...finalCosts));

  const channelUnreachable = selected < 0 || !Number.isFinite(finalCosts[selected]);
  if (channelUnreachable) throw new Error("Unable to route a river around the bases");

  const result: Channel[] = new Array(segments.length);

  for (let index = segments.length - 1; index >= 0; index--) {
    result[index] = segments[index]!.channels[selected]!;
    selected = scores[index]!.parents[selected]!;
  }

  return result;
}

function createRiverSegments(
  map: GameMap,
  protectedCells: Position[],
  random: () => number,
): Segment[] {
  const protectedKeys = new Set(protectedCells.map(positionKey));
  const maxWidth = Math.min(5, Math.max(3, Math.round(map.width / 8)));
  const bendPhase = random() * Math.PI * 2;
  const widthPhase = random() * Math.PI * 2;
  const context = { map, protectedKeys, maxWidth };
  const segments: Segment[] = [];

  for (let row = 0; row < map.height; ) {
    // A crossing occupies the middle row of a straight three-row stretch.
    // This leaves visible water above and below every tile of its deck.
    const crossing = row % 6 === 2 && row + 2 < map.height;
    const lastRow = crossing ? row + 2 : row;
    segments.push(
      createRiverSegment(context, { firstRow: row, lastRow }, { bendPhase, widthPhase }),
    );
    row = lastRow + 1;
  }

  return segments;
}

function availableChannels(context: RiverRoutingContext, rows: RowSpan): Channel[] {
  const { map, protectedKeys, maxWidth } = context;
  const channels: Channel[] = [];

  for (let width = 2; width <= maxWidth; width++) {
    for (let left = 1; left + width < map.width; left++) {
      const bounds = { left, right: left + width - 1, top: rows.firstRow, bottom: rows.lastRow };
      addUnprotectedChannel(channels, protectedKeys, bounds);
    }
  }

  return channels;
}

function addUnprotectedChannel(
  channels: Channel[],
  protectedKeys: Set<string>,
  bounds: CellBounds,
): void {
  for (const position of cellsInRectangle(bounds))
    if (protectedKeys.has(positionKey(position))) return;

  channels.push({ left: bounds.left, right: bounds.right });
}

function paintRiverSegment(map: GameMap, segment: Segment, channel: Channel): void {
  const { left, right } = channel;

  for (const { x, y } of cellsInRectangle({
    left,
    top: segment.firstRow,
    right,
    bottom: segment.lastRow,
  }))
    map.tiles[y]![x] = y === segment.bridgeRow ? "bridge" : "water";
}

function scoreSegmentChannels(segment: Segment, previous?: SegmentScores): SegmentScores {
  const costs = segment.channels.map(() => Infinity);
  const parents = segment.channels.map(() => -1);

  for (const [index, channel] of segment.channels.entries()) {
    const center = (channel.left + channel.right) / 2;
    const width = channel.right - channel.left + 1;
    const preference =
      Math.abs(center - segment.desiredCenter) + Math.abs(width - segment.desiredWidth) * 3;

    const selection = previous
      ? chooseChannelParent(channel, previous, preference)
      : { cost: preference, parent: -1 };
    costs[index] = selection.cost;
    parents[index] = selection.parent;
  }

  return { segment, costs, parents };
}

function chooseChannelParent(
  channel: Channel,
  previous: SegmentScores,
  preference: number,
): ChannelParent {
  let selection = { cost: Infinity, parent: -1 };

  for (const [index, last] of previous.segment.channels.entries()) {
    // Shared columns keep the water connected in four cardinal directions.
    const channelsDisconnected = last.right < channel.left || channel.right < last.left;
    if (channelsDisconnected) continue;

    const bend = Math.abs(last.left - channel.left) + Math.abs(last.right - channel.right);
    const cost = previous.costs[index]! + preference + bend * 2;
    if (cost < selection.cost) selection = { cost, parent: index };
  }

  return selection;
}

function createRiverSegment(
  context: RiverRoutingContext,
  rows: RowSpan,
  shape: { bendPhase: number; widthPhase: number },
): Segment {
  const { firstRow: row, lastRow } = rows;
  const { map, maxWidth } = context;
  const { bendPhase, widthPhase } = shape;
  const channels = availableChannels(context, rows);
  const middleRow = (row + lastRow) / 2;

  return {
    firstRow: row,
    lastRow,
    bridgeRow: lastRow > row ? row + 1 : undefined,
    channels,
    desiredCenter: (map.width - 1) / 2 + Math.sin(middleRow / 6 + bendPhase) * map.width * 0.1,
    desiredWidth:
      2 + Math.round((maxWidth - 2) * (0.5 + Math.sin(middleRow / 4 + widthPhase) * 0.5)),
  };
}
