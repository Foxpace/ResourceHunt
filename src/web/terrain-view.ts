import { TERRAIN_COST, type Biome, type GameMap, type Terrain } from "../engine/types.ts";

type Swatch = readonly [base: string, detail: string];
const colors: Record<Terrain, Swatch> = {
  grass: ["#2c412d", "#425b37"],
  forest: ["#223b29", "#506f43"],
  mountain: ["#3e493b", "#88937b"],
  water: ["#24515e", "#568b98"],
  bridge: ["#24515e", "#baa273"],
  sand: ["#ba8b50", "#dcb77c"],
  dune: ["#9e6d3d", "#d1a260"],
  oasis: ["#526b4a", "#9bb57a"],
  regolith: ["#51566b", "#71788f"],
  crater: ["#383d50", "#68708a"],
  cliff: ["#292d35", "#6b7081"],
  basalt: ["#353237", "#50434a"],
  ash: ["#5f5051", "#897071"],
  lava: ["#b43e24", "#ffac4a"],
  snow: ["#b0c8d4", "#e4eff1"],
  ice: ["#6eabbf", "#b0dce7"],
  thicket: ["#162d23", "#304d34"],
};
const themes: Partial<Record<Biome, Partial<Record<Terrain, Swatch>>>> = {
  valley: {
    grass: ["#4c6040", "#738257"],
    mountain: ["#5c5349", "#9d927b"],
    cliff: ["#342e2b", "#776753"],
  },
  desert: {
    mountain: ["#7b5038", "#c29264"],
    cliff: ["#553b30", "#997052"],
    water: ["#2f7777", "#69b5a2"],
  },
  moon: { mountain: ["#626779", "#a2a7b9"], cliff: ["#252938", "#626b83"] },
  volcanic: { mountain: ["#43383e", "#856970"], cliff: ["#29252c", "#66525c"] },
  archipelago: {
    grass: ["#3a6847", "#58875a"],
    water: ["#23576b", "#438899"],
    bridge: ["#23576b", "#ccb58a"],
  },
  tundra: { mountain: ["#688390", "#deebee"], water: ["#294b66", "#52829f"] },
  forest: { grass: ["#42523a", "#65744c"], forest: ["#2a4230", "#5b754b"] },
};

/** Theme colors and terrain glyphs live together, independent of game overlays. */
export function drawTerrain(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  biome: Biome,
  cw: number,
  ch: number,
) {
  const s = Math.min(cw, ch);
  for (let y = 0; y < map.height; y++)
    for (let x = 0; x < map.width; x++) {
      const terrain = map.tiles[y]![x]!;
      const [base, detail] = themes[biome]?.[terrain] ?? colors[terrain];
      const px = (x + 0.5) * cw,
        py = (y + 0.5) * ch;
      ctx.fillStyle = base;
      ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
      ctx.fillStyle = (x * 7 + y * 13 + x * y) % 3 ? "#ffffff04" : "#00000007";
      ctx.fillRect(x * cw, y * ch, cw, ch);
      ctx.strokeStyle = "#08111824";
      ctx.lineWidth = 0.5;
      ctx.strokeRect(x * cw, y * ch, cw, ch);
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(s, s);
      ctx.fillStyle = detail;
      ctx.strokeStyle = detail;
      ctx.lineWidth = 0.04;
      const line = (points: number[][]) => {
        ctx.beginPath();
        for (const [i, p] of points.entries())
          i ? ctx.lineTo(p[0]!, p[1]!) : ctx.moveTo(p[0]!, p[1]!);
        ctx.stroke();
      };
      if (terrain === "mountain") {
        ctx.beginPath();
        ctx.moveTo(0, -0.32);
        ctx.lineTo(-0.34, 0.25);
        ctx.lineTo(0.34, 0.25);
        ctx.fill();
        line([
          [0, -0.26],
          [0.08, 0.03],
          [0.25, 0.19],
        ]);
      } else if (terrain === "forest" || terrain === "thicket") {
        for (const dx of [-0.17, 0.17]) {
          ctx.beginPath();
          ctx.moveTo(dx, -0.33);
          ctx.lineTo(dx - 0.18, 0.21);
          ctx.lineTo(dx + 0.18, 0.21);
          ctx.fill();
        }
      } else if (terrain === "cliff") {
        line([
          [-0.42, 0.29],
          [-0.18, -0.24],
          [0.06, 0.15],
          [0.25, -0.27],
          [0.42, 0.2],
        ]);
        line([
          [-0.18, -0.24],
          [-0.18, 0.36],
        ]);
      } else if (terrain === "crater") {
        ctx.beginPath();
        ctx.ellipse(0, 0, 0.32, 0.24, -0.3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0.04, 0.02, 0.15, 0, Math.PI);
        ctx.stroke();
      } else if (terrain === "dune" || terrain === "sand") {
        if (terrain === "dune" || (x + y) % 3 === 0) {
          ctx.beginPath();
          ctx.moveTo(-0.4, 0.15);
          ctx.quadraticCurveTo(-0.05, -0.27, 0.4, -0.05);
          ctx.stroke();
          if (terrain === "dune")
            line([
              [-0.3, 0.32],
              [0.1, 0.16],
              [0.35, 0.18],
            ]);
        }
      } else if (terrain === "oasis") {
        line([
          [0, 0.3],
          [0.02, -0.15],
          [-0.27, -0.02],
        ]);
        line([
          [-0.25, -0.24],
          [0.02, -0.15],
          [0.3, -0.05],
        ]);
        line([
          [0.02, -0.15],
          [0.2, -0.3],
        ]);
      } else if (terrain === "lava" || terrain === "ice") {
        line([
          [-0.5, -0.2],
          [-0.18, 0.02],
          [0.1, -0.1],
          [0.5, 0.23],
        ]);
        line([
          [-0.18, 0.02],
          [-0.06, 0.45],
        ]);
      } else if (terrain === "snow") {
        if ((x + y) % 3 === 0) {
          line([
            [-0.17, 0],
            [0.17, 0],
          ]);
          line([
            [0, -0.17],
            [0, 0.17],
          ]);
        }
      } else if (terrain === "water") {
        line([
          [-0.28, 0.08],
          [0.22, 0.08],
        ]);
      } else if (terrain === "regolith" || terrain === "basalt" || terrain === "ash") {
        ctx.fillRect(-0.2, 0.17, 0.06, 0.06);
        ctx.fillRect(0.19, -0.22, 0.05, 0.05);
      }
      ctx.restore();
      if (terrain === "bridge") drawBridge(ctx, map, x, y, cw, ch, detail);
    }
}

function drawBridge(
  ctx: CanvasRenderingContext2D,
  map: GameMap,
  x: number,
  y: number,
  cw: number,
  ch: number,
  color: string,
) {
  const px = (x + 0.5) * cw,
    py = (y + 0.5) * ch;
  ctx.fillStyle = color;
  ctx.fillRect(px - cw * 0.25, py - ch * 0.25, cw * 0.5, ch * 0.5);
  // Join real neighboring land/decks, including north/south crossings and corners.
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ]) {
    const tile = map.tiles[y + dy!]?.[x + dx!];
    if (!tile || !Number.isFinite(TERRAIN_COST[tile])) continue;
    ctx.fillRect(
      px + (dx! < 0 ? -cw * 0.5 : -cw * 0.25),
      py + (dy! < 0 ? -ch * 0.5 : -ch * 0.25),
      cw * (dx ? 0.75 : 0.5),
      ch * (dy ? 0.75 : 0.5),
    );
    ctx.strokeStyle = "#534a3a";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    if (dx) {
      ctx.moveTo(px + dx * cw * 0.3, py - ch * 0.25);
      ctx.lineTo(px + dx * cw * 0.3, py + ch * 0.25);
    } else {
      ctx.moveTo(px - cw * 0.25, py + dy! * ch * 0.3);
      ctx.lineTo(px + cw * 0.25, py + dy! * ch * 0.3);
    }
    ctx.stroke();
  }
}
