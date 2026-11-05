import { describeWorldCell } from "./world-description.ts";
import { samePosition } from "../../engine/pathfinding.ts";
import { manhattanDistance } from "../../engine/grid.ts";
import { TERRAIN_COST, type Snapshot } from "../../engine/types.ts";

export function describeMapCell(state: Snapshot, x: number, y: number): string {
  const terrain = state.map.tiles[y]?.[x];
  if (!terrain) return "";

  const resource = state.resources.find((pile) => samePosition(pile, { x, y }));
  const bots = state.bots.filter((bot) => samePosition(bot.position, { x, y }));
  const post = state.outposts.find((post) => samePosition(post, { x, y }));
  const hotspot = state.hotspots.find((site) => manhattanDistance(site, { x, y }) <= site.radius);
  const owner = state.bots.find((bot) => bot.id === post?.ownerId);
  let description = `${x},${y} · ${terrain} · ${Number.isFinite(TERRAIN_COST[terrain]) ? `${TERRAIN_COST[terrain]} turn${TERRAIN_COST[terrain] === 1 ? "" : "s"}` : "blocked"}${resource ? ` · ${resource.amount} ${resource.kind}` : ""}${bots.length ? ` · ${bots.map((bot) => bot.name).join(", ")}` : ""}`;
  if (post)
    description += ` · ${post.id}: ${owner?.name ?? "neutral"}${post.captureProgress ? ` · capture ${post.captureProgress}/${state.config.captureTurns}` : ""}`;
  if (hotspot) description += ` · ${hotspot.id}`;

  return description + describeWorldCell(state, { x, y });
}
