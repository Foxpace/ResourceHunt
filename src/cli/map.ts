import type { Frame, GameMap, Position } from "../engine/types.ts";

export function renderTerminalMap(frame: Frame, map: GameMap): string {
  const cells = map.tiles.map((row) => row.map((tile) => tile[0]!));
  const mark = (position: Position, character: string) => {
    cells[position.y]![position.x] = character;
  };
  for (const hotspot of frame.hotspots) mark(hotspot, "H");
  for (const resource of frame.resources) mark(resource, "*");
  for (const outpost of frame.outposts) mark(outpost, "O");
  for (const trap of frame.world.traps) mark(trap, "^");
  for (const drone of frame.world.drones) {
    if (drone.health > 0) mark(drone.position, "D");
  }
  for (const cache of frame.world.caches) {
    mark(cache.position, "C");
    if (cache.guardianHealth > 0) mark(cache.guardianPosition ?? cache.position, "G");
  }
  const symbols = "123456789ABCDEF";
  frame.bots.forEach((bot, index) => mark(bot.position, symbols[index]!));
  const legend = frame.bots.map((bot, index) => `${symbols[index]} ${bot.name}`).join(" · ");
  return [
    ...cells.map((row) => row.join("")),
    legend,
    "* Resource · H Hotspot · O Depot · ^ Trap · D Drone · C Cache · G Guardian",
  ].join("\n");
}
