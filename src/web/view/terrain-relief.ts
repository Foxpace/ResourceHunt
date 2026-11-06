import type { Biome, GameMap, Position, Terrain } from "../../engine/types.ts";
import type { CanvasGrid } from "./canvas-grid.ts";
import type { UnitTile } from "./terrain-glyphs.ts";
import { terrainClass, terrainSwatch, tileNoise } from "./terrain-palette.ts";

export interface TerrainScene {
  readonly grid: CanvasGrid;
  readonly map: GameMap;
  readonly biome: Biome;
}

const NEIGHBORS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
] as const;

export function terrainAt(scene: TerrainScene, position: Position): Terrain | undefined {
  return scene.map.tiles[position.y]?.[position.x];
}

export function inUnitTile(
  scene: TerrainScene,
  position: Position,
  draw: (tile: UnitTile) => void,
): void {
  const { context, cellWidth, cellHeight, cellSize } = scene.grid;
  const terrain = terrainAt(scene, position)!;
  context.save();
  context.translate((position.x + 0.5) * cellWidth, (position.y + 0.5) * cellHeight);
  context.scale(cellSize, cellSize);
  draw({ context, terrain, swatch: terrainSwatch(terrain, scene.biome), ...position });
  context.restore();
}

/** Soft shallows and a foam line wherever water or lava meets dry ground. */
export function drawShoreline(scene: TerrainScene, position: Position): void {
  const terrain = terrainAt(scene, position);
  const wet = terrain === "water" || terrain === "bridge" || terrain === "lava";
  if (!wet) return;

  for (const delta of NEIGHBORS) {
    const neighbor = terrainAt(scene, { x: position.x + delta.x, y: position.y + delta.y });
    const neighborWet = !neighbor || terrainClass(neighbor) === "liquid" || neighbor === "bridge";
    if (neighborWet) continue;

    inUnitTile(scene, position, (tile) => drawShoreEdge(tile, delta));
  }
}

function drawShoreEdge(tile: UnitTile, delta: Position): void {
  const { context } = tile;
  const lava = tile.terrain === "lava";
  context.rotate(Math.atan2(delta.y, delta.x));
  const band = context.createLinearGradient(0.5, 0, 0.12, 0);
  band.addColorStop(0, lava ? "#2a1209dd" : `${tile.swatch[1]}aa`);
  band.addColorStop(1, lava ? "#2a120900" : `${tile.swatch[1]}00`);
  context.fillStyle = band;
  context.fillRect(0.12, -0.5, 0.38, 1);
  context.fillStyle = lava ? "#ffcf7a99" : "#e8fbff66";
  context.fillRect(0.42, -0.5, 0.06, 1);
}

/** Cliffs and thickets throw a shadow to the south-east so the board reads in depth. */
export function drawCastShadow(scene: TerrainScene, position: Position): void {
  const terrain = terrainAt(scene, position);
  const casts = terrain === "cliff" || terrain === "thicket";
  if (!casts) return;

  const { context, cellWidth, cellHeight } = scene.grid;
  const south = terrainAt(scene, { x: position.x, y: position.y + 1 });
  if (south !== terrain) {
    const top = (position.y + 1) * cellHeight;
    const shadow = context.createLinearGradient(0, top, 0, top + cellHeight * 0.45);
    shadow.addColorStop(0, "#0000006a");
    shadow.addColorStop(1, "#00000000");
    context.fillStyle = shadow;
    context.fillRect(position.x * cellWidth + cellWidth * 0.12, top, cellWidth, cellHeight * 0.45);
  }

  const east = terrainAt(scene, { x: position.x + 1, y: position.y });
  if (east === terrain) return;
  const left = (position.x + 1) * cellWidth;
  const side = context.createLinearGradient(left, 0, left + cellWidth * 0.3, 0);
  side.addColorStop(0, "#00000048");
  side.addColorStop(1, "#00000000");
  context.fillStyle = side;
  context.fillRect(left, position.y * cellHeight + cellHeight * 0.15, cellWidth * 0.3, cellHeight);
}

export function drawCanopy(scene: TerrainScene, position: Position): void {
  const terrain = terrainAt(scene, position);
  if (terrain === "forest") inUnitTile(scene, position, drawForestTrees);
  else if (terrain === "thicket") inUnitTile(scene, position, drawThicketMass);
}

function drawTree(tile: UnitTile, crown: { x: number; y: number; radius: number }): void {
  const { context, swatch } = tile;
  context.fillStyle = "#0000004d";
  context.beginPath();
  context.ellipse(
    crown.x + 0.05,
    crown.y + 0.09,
    crown.radius,
    crown.radius * 0.8,
    0,
    0,
    Math.PI * 2,
  );
  context.fill();
  context.fillStyle = swatch[1];
  context.beginPath();
  context.arc(crown.x, crown.y, crown.radius, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = "#ffffff1f";
  context.beginPath();
  context.arc(
    crown.x - crown.radius * 0.3,
    crown.y - crown.radius * 0.35,
    crown.radius * 0.45,
    0,
    Math.PI * 2,
  );
  context.fill();
}

function drawForestTrees(tile: UnitTile): void {
  const layout = [
    { x: -0.2, y: -0.16 },
    { x: 0.2, y: -0.08 },
    { x: -0.04, y: 0.2 },
  ];
  for (const [index, spot] of layout.entries()) {
    const jitterX = (tileNoise(tile.x, tile.y, 20 + index) - 0.5) * 0.12;
    const jitterY = (tileNoise(tile.x, tile.y, 30 + index) - 0.5) * 0.12;
    const radius = 0.17 + tileNoise(tile.x, tile.y, 40 + index) * 0.06;
    drawTree(tile, { x: spot.x + jitterX, y: spot.y + jitterY, radius });
  }
}

function drawThicketMass(tile: UnitTile): void {
  const { context } = tile;
  context.fillStyle = "#0b1a10";
  context.fillRect(-0.5, -0.5, 1, 1);
  const layout = [
    { x: -0.24, y: -0.24 },
    { x: 0.24, y: -0.22 },
    { x: -0.22, y: 0.22 },
    { x: 0.24, y: 0.24 },
    { x: 0, y: 0 },
  ];
  for (const [index, spot] of layout.entries()) {
    const radius = 0.26 + tileNoise(tile.x, tile.y, 50 + index) * 0.08;
    drawTree(tile, { ...spot, radius });
  }
}

/** Cliffs rise as blocks with a lit top face; mountains rise as shaded peaks. */
export function drawRaisedTerrain(scene: TerrainScene, position: Position): void {
  const terrain = terrainAt(scene, position);
  if (terrain === "cliff") drawCliffBlock(scene, position);
  else if (terrain === "mountain") inUnitTile(scene, position, drawMountainPeak);
}

function drawCliffBlock(scene: TerrainScene, position: Position): void {
  const southOpen = terrainAt(scene, { x: position.x, y: position.y + 1 }) !== "cliff";
  const northOpen = terrainAt(scene, { x: position.x, y: position.y - 1 }) !== "cliff";
  inUnitTile(scene, position, (tile) => {
    const { context, swatch } = tile;
    const lift = 0.22;
    context.fillStyle = swatch[1];
    context.fillRect(-0.5, -0.5 - lift, 1, 1);
    context.fillStyle = "#0000002a";
    context.fillRect(-0.5, -0.5 - lift, 1, 1);
    if (northOpen) {
      context.fillStyle = "#ffffff30";
      context.fillRect(-0.5, -0.5 - lift, 1, 0.06);
    }
    drawCliffStrata(tile, lift);
    if (!southOpen) return;

    context.fillStyle = swatch[0];
    context.fillRect(-0.5, 0.5 - lift, 1, lift);
    context.fillStyle = "#00000059";
    context.fillRect(-0.5, 0.5 - lift, 1, lift);
  });
}

function drawCliffStrata(tile: UnitTile, lift: number): void {
  const { context } = tile;
  context.strokeStyle = "#00000033";
  context.lineWidth = 0.035;
  context.beginPath();
  const offset = (tileNoise(tile.x, tile.y, 60) - 0.5) * 0.3;
  context.moveTo(-0.38, offset - lift);
  context.lineTo(-0.05, offset - lift - 0.12);
  context.lineTo(0.3, offset - lift + 0.05);
  context.stroke();
}

function drawMountainPeak(tile: UnitTile): void {
  const { context, swatch } = tile;
  const height = 0.62 + tileNoise(tile.x, tile.y, 70) * 0.18;
  const top = 0.32 - height;
  context.fillStyle = "#00000040";
  context.beginPath();
  context.ellipse(0.06, 0.34, 0.42, 0.1, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = swatch[1];
  context.beginPath();
  context.moveTo(0, top);
  context.lineTo(-0.42, 0.32);
  context.lineTo(0.06, 0.32);
  context.fill();
  context.fillStyle = "#00000047";
  context.beginPath();
  context.moveTo(0, top);
  context.lineTo(0.06, 0.32);
  context.lineTo(0.42, 0.32);
  context.fill();
  context.fillStyle = "#f2f4ecd9";
  context.beginPath();
  context.moveTo(0, top);
  context.lineTo(-0.12, top + 0.2);
  context.lineTo(0.02, top + 0.15);
  context.lineTo(0.1, top + 0.2);
  context.fill();
}

export function drawBridgeDeck(scene: TerrainScene, position: Position): void {
  if (terrainAt(scene, position) !== "bridge") return;

  const east = terrainAt(scene, { x: position.x + 1, y: position.y });
  const west = terrainAt(scene, { x: position.x - 1, y: position.y });
  const horizontal = isDry(east) || isDry(west);
  inUnitTile(scene, position, (tile) => {
    if (!horizontal) tile.context.rotate(Math.PI / 2);
    drawPlanks(tile);
  });
}

function isDry(terrain: Terrain | undefined): boolean {
  return !!terrain && terrain !== "water" && terrain !== "lava";
}

function drawPlanks(tile: UnitTile): void {
  const { context, swatch } = tile;
  context.fillStyle = "#00000055";
  context.fillRect(-0.5, -0.24, 1, 0.58);
  context.fillStyle = swatch[1];
  context.fillRect(-0.5, -0.3, 1, 0.6);
  context.strokeStyle = "#5a40227a";
  context.lineWidth = 0.035;
  context.beginPath();
  for (const x of [-0.3, -0.1, 0.1, 0.3]) {
    context.moveTo(x, -0.3);
    context.lineTo(x, 0.3);
  }
  context.stroke();
  context.fillStyle = "#4b3420";
  context.fillRect(-0.5, -0.34, 1, 0.07);
  context.fillRect(-0.5, 0.27, 1, 0.07);
}
