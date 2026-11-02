import { minimumMapSize } from "../engine/map-layout.ts";
import { MAX_BOTS } from "../engine/types.ts";
import { BIOMES } from "../engine/biomes.ts";
import { botSelection, standings, eventLog } from "./views.ts";
import { HttpGameClient } from "./client.ts";
import { Playback } from "./playback.ts";
import { drawMap, attachMapTooltip } from "./map-view.ts";
import { parseReplay } from "../engine/replay.ts";
import { type BotMetadata, type GameConfig } from "../engine/types.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const button = (id: string) => $<HTMLButtonElement>(id);
let catalog: BotMetadata[] = [];
const client = new HttpGameClient();
const playback = new Playback(client);
let generating = false;
let toastTimer: ReturnType<typeof setTimeout>;

function toast(message: string) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("toast").hidden = true;
  }, 7000);
}
async function refreshBots(initial = false) {
  const previous = new Set(selectedBotIds());
  button("refresh-bots").disabled = true;
  try {
    const data = await client.bots();
    catalog = data.bots;
    const selected = initial ? new Set(data.defaultBotIds) : previous;
    $("bot-list").innerHTML = botSelection(catalog, selected);
    document
      .querySelectorAll(".bot-select")
      .forEach((element) => element.addEventListener("change", updateSelection));
    updateSelection();
    if (data.errors.length)
      toast(data.errors.map((error) => `${error.file}: ${error.error}`).join(" · "));
  } finally {
    button("refresh-bots").disabled = false;
  }
}
function updateSelection() {
  const count = document.querySelectorAll(".bot-select:checked").length;
  fitMapDimensions(count);
  $("selected-count").textContent = `${count}/${MAX_BOTS}`;
  button("generate").disabled = generating || count < 1 || count > MAX_BOTS;
}
function fitMapDimensions(count: number) {
  const min = minimumMapSize(count, $<HTMLSelectElement>("biome").value as GameConfig["biome"]);
  for (const id of ["width", "height"]) {
    input(id).min = String(min);
    if (Number(input(id).value) < min) input(id).value = String(min);
  }
}
function configFromForm(): GameConfig {
  return {
    biome: $<HTMLSelectElement>("biome").value as GameConfig["biome"],
    width: Number(input("width").value),
    height: Number(input("height").value),
    ticks: Number(input("ticks").value),
    seed: input("seed").value,
    baseLayout: $<HTMLSelectElement>("layout").value as GameConfig["baseLayout"],
    resourceDensity: Number(input("resources").value) / 100,
    terrainDensity: Number(input("terrain").value) / 100,
    capacity: Number(input("capacity").value),
    decisionTimeoutMs: Number(input("timeout").value),
    hotspotCount: Number(input("hotspots").value),
    outpostCount: Number(input("outposts").value),
    captureTurns: Number(input("capture-turns").value),
    stealing: input("stealing").checked,
    stealCooldownTicks: Number(input("steal-cooldown").value),
  };
}
async function generate() {
  if (generating) return;
  generating = true;
  playback.pause();
  updateSelection();
  button("generate").textContent = "Generating…";
  try {
    const botIds = selectedBotIds();
    await playback.create({ config: configFromForm(), botIds });
    render();
  } catch (error) {
    toast(String(error));
  } finally {
    generating = false;
    button("generate").textContent = "Generate";
    updateSelection();
    renderControls();
  }
}
function renderControls() {
  const snapshot = playback.snapshot;
  const finished = !!snapshot?.finished;
  button("play").disabled = !playback.canPlay || generating;
  button("play").textContent = playback.isPlaying ? "Pause" : finished ? "Replay" : "Run";
  button("step").disabled = !playback.canStep || generating;
  button("export").disabled = !snapshot || generating;
  input("timeline").disabled = playback.length < 2 || generating;
  input("timeline").max = String(snapshot?.config.ticks ?? 0);
  input("timeline").value = String(snapshot?.tick ?? 0);
  $("playback-mode").hidden = !playback.isReplay;
}
function render() {
  const state = playback.snapshot;
  if (!state) {
    renderControls();
    return;
  }
  $("map-empty").hidden = true;
  $("competition-rules").textContent =
    `Capture: ${state.config.captureTurns} turns. ${state.config.stealing ? `Theft cooldown: ${state.config.stealCooldownTicks} ticks. Both participants are protected for the following tick.` : "Cargo theft disabled."}`;
  $("map").setAttribute(
    "aria-label",
    `${BIOMES[state.config.biome].name} map with ${state.hotspots.length} hotspots and ${state.outposts.length} outposts`,
  );

  $("tick-label").textContent = `${state.tick} / ${state.config.ticks}`;
  $("standings").innerHTML = standings(state);
  $("event-log").innerHTML = eventLog(state.bots, playback.recentEvents());
  $("map-container").style.aspectRatio = `${state.map.width}/${state.map.height}`;
  renderControls();
  drawMap(canvas, state);
}

const biomeSelect = $<HTMLSelectElement>("biome");
for (const [id, biome] of Object.entries(BIOMES)) {
  const option = document.createElement("option");
  option.value = id;
  option.textContent = biome.name;
  biomeSelect.append(option);
}
function describeBiome() {
  $("biome-description").textContent = BIOMES[biomeSelect.value as GameConfig["biome"]].description;
}
biomeSelect.onchange = () => {
  describeBiome();
  fitMapDimensions(selectedBotIds().length);
};
describeBiome();

const canvas = $<HTMLCanvasElement>("map");
new ResizeObserver(() => {
  if (playback.snapshot) drawMap(canvas, playback.snapshot);
}).observe($("map-container"));
attachMapTooltip(canvas, $("map-tooltip"), () => playback.snapshot);
playback.subscribe(render);

function selectedBotIds(): string[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>(".bot-select:checked")).map(
    (element) => element.value,
  );
}

$("config-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void generate();
});
button("shuffle").onclick = () => {
  input("seed").value = `field-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`;
};
button("refresh-bots").onclick = () => {
  void refreshBots().catch((error) => toast(String(error)));
};
for (const id of ["resources", "terrain"])
  input(id).oninput = () => {
    $(`${id}-value`).textContent = `${input(id).value}%`;
  };
button("play").onclick = () => {
  if (!generating)
    void playback
      .play(() => Number($<HTMLSelectElement>("speed").value))
      .catch((error) => toast(String(error)));
};
button("step").onclick = () => {
  void playback.step().catch((error) => toast(String(error)));
};
input("timeline").oninput = () => {
  void playback.seek(Number(input("timeline").value)).catch((error) => toast(String(error)));
};
button("rules-button").onclick = () => $<HTMLDialogElement>("rules").showModal();
button("close-rules").onclick = () => $<HTMLDialogElement>("rules").close();
button("import").onclick = () => input("replay-file").click();
input("replay-file").onchange = async () => {
  const file = input("replay-file").files?.[0];
  if (!file) return;
  try {
    if (file.size > 50 * 1024 * 1024) throw new Error("Replay must be smaller than 50 MB");
    const replay = parseReplay(JSON.parse(await file.text()));
    await playback.load(replay);
  } catch (error) {
    toast(String(error));
  } finally {
    input("replay-file").value = "";
  }
};
button("export").onclick = async () => {
  try {
    const replay = await playback.export();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(replay)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `resource-hunt-${replay.initial.config.seed.replace(/[^a-z0-9-]/gi, "_")}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    toast(String(error));
  }
};
window.addEventListener("pagehide", () => {
  void playback.dispose();
});
void refreshBots(true)
  .then(() => {
    if (catalog.length) return generate();
  })
  .catch((error) => toast(`Cannot reach the local engine: ${String(error)}`));
