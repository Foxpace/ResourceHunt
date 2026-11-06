import { BIOMES } from "../../engine/biomes.ts";
import { generateMap } from "../../engine/map.ts";
import type { Biome, GameConfig, GameMap, Position } from "../../engine/types.ts";
import { escapeHtml } from "./panels.ts";
import { BIOME_AMBIENCE, terrainClass, terrainSwatch } from "./terrain-palette.ts";

const biomeIds = Object.keys(BIOMES) as Biome[];

export interface PreviewRequest {
  config: GameConfig;
  botCount: number;
}

/** Biome cards with pixel minimaps generated from the same seed the match will use. */
export class BiomePicker {
  private timer?: ReturnType<typeof setTimeout>;
  private previewKey = "";

  constructor(
    private container: HTMLElement,
    private onChange: (biome: Biome) => void,
  ) {
    container.innerHTML = biomeIds.map(renderBiomeCard).join("");
    container.addEventListener("change", () => this.onChange(this.value));
  }

  get value(): Biome {
    const checked = this.container.querySelector<HTMLInputElement>("input:checked");
    return (checked?.value ?? "riverlands") as Biome;
  }

  /** Regenerates previews after input settles, one biome per task to keep typing responsive. */
  schedulePreviews(request: PreviewRequest): void {
    const { seed, width, height, baseLayout, terrainDensity } = request.config;
    const key = JSON.stringify([seed, width, height, baseLayout, terrainDensity, request.botCount]);
    if (key === this.previewKey) return;

    this.previewKey = key;
    clearTimeout(this.timer);
    const queue = [...biomeIds];
    const next = () => {
      const biome = queue.shift();
      if (!biome) return;
      if (key !== this.previewKey) return;

      this.drawPreview(biome, request);
      this.timer = setTimeout(next, 0);
    };
    this.timer = setTimeout(next, 250);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }

  private drawPreview(biome: Biome, request: PreviewRequest): void {
    const canvas = this.container.querySelector<HTMLCanvasElement>(
      `canvas[data-biome="${biome}"]`,
    )!;
    try {
      const { map, bases } = generateMap({ ...request.config, biome }, request.botCount);
      paintMinimap(canvas, { map, bases, biome });
    } catch {
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
}

function renderBiomeCard(biome: Biome, index: number): string {
  const { name } = BIOMES[biome];
  return `<label class="biome-card" style="--ambience:${BIOME_AMBIENCE[biome]}" title="${escapeHtml(BIOMES[biome].description)}">
    <input type="radio" name="biome" value="${biome}" ${index === 0 ? "checked" : ""} />
    <canvas data-biome="${biome}" width="33" height="25" aria-hidden="true"></canvas>
    <span>${escapeHtml(name)}</span>
  </label>`;
}

function paintMinimap(
  canvas: HTMLCanvasElement,
  preview: { map: GameMap; bases: Position[]; biome: Biome },
): void {
  const { map, bases, biome } = preview;
  canvas.width = map.width;
  canvas.height = map.height;
  const context = canvas.getContext("2d")!;
  for (const [y, row] of map.tiles.entries()) {
    for (const [x, terrain] of row.entries()) {
      const [base, detail] = terrainSwatch(terrain, biome);
      const raised = terrainClass(terrain) === "raised" || terrainClass(terrain) === "canopy";
      context.fillStyle = raised ? detail : base;
      context.fillRect(x, y, 1, 1);
    }
  }
  context.fillStyle = "#ffffff";
  for (const base of bases) context.fillRect(base.x, base.y, 1, 1);
}
