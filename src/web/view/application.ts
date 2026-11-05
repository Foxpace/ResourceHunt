import type { Snapshot } from "../../engine/types.ts";
import { configurableResultColumns, renderMatchResults } from "./results.ts";
import { TournamentView } from "./tournament.ts";
import { AnimatedMapView } from "./animated-map.ts";
import { renderWorldStatus } from "./world-status.ts";
import { MAX_BOTS } from "../../engine/types.ts";
import { BIOMES } from "../../engine/biomes.ts";
import {
  renderBotSelection,
  renderStandings,
  renderEventLog,
  renderBotStatistics,
  renderStatisticsOptions,
} from "./panels.ts";
import { ApplicationModel } from "../model/application.ts";
import { attachMapTooltip } from "./map.ts";
import { type Replay, type BotMetadata, type GameConfig } from "../../engine/types.ts";

const getElement = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => getElement<HTMLInputElement>(id);
const tabs = ["arena", "results", "tournament"] as const;
type CompetitionTab = (typeof tabs)[number];
const button = (id: string) => getElement<HTMLButtonElement>(id);
/** DOM bindings render model state and translate browser events into intents. */
export class ApplicationView {
  private hiddenResultColumns = new Set<string>();
  private activeTab: CompetitionTab = "arena";
  private renderedFinal?: Snapshot;
  private toastTimer?: ReturnType<typeof setTimeout>;
  private renderedCatalog?: readonly BotMetadata[];
  private renderedSelection?: readonly string[];
  private renderedMessage = "";
  private renderedStatisticsOptions = "";
  private canvas = getElement<HTMLCanvasElement>("map");
  private mapView = new AnimatedMapView(this.canvas);
  private biomeSelect = getElement<HTMLSelectElement>("biome");
  private resizeObserver!: ResizeObserver;
  private unsubscribe!: () => void;
  private detachTooltip!: () => void;

  constructor(
    private model: ApplicationModel,
    private tournament: TournamentView,
  ) {
    for (const tab of tabs) button(`tab-${tab}`).onclick = () => this.showTab(tab);
    this.initializeBiomeOptions();
    this.observeMap();
    this.bindConfigEvents();
    this.bindResultOptions();
    this.bindPlaybackEvents();
    this.bindDialogs();
    getElement<HTMLDetailsElement>("bot-statistics").ontoggle = () => this.renderStatistics();
    getElement<HTMLSelectElement>("statistics-bot").onchange = () => this.renderStatistics();
    this.bindReplayEvents();
  }

  dispose(): void {
    clearTimeout(this.toastTimer);
    this.resizeObserver.disconnect();
    this.mapView.dispose();
    this.tournament.tournament.dispose();
    this.unsubscribe();
    this.detachTooltip();
  }

  private renderApplication() {
    const state = this.model.state;
    this.renderBotOptions();

    button("refresh-bots").disabled = state.refreshing;
    button("generate").disabled = !state.canGenerate;
    this.renderTournamentButton();
    button("generate").textContent = state.generating ? "Generating…" : "Generate";
    getElement("selected-count").textContent = `${state.selectedBotIds.length}/${MAX_BOTS}`;
    getElement("selected-count").classList.toggle(
      "over-limit",
      state.selectedBotIds.length > MAX_BOTS,
    );

    this.renderMessage(state.message);
    this.renderMatch();
    this.renderFinalResults();
  }

  private renderMessage(message: string) {
    getElement("toast").textContent = message;
    getElement("toast").hidden = !message;
    if (message === this.renderedMessage) return;

    this.renderedMessage = message;
    clearTimeout(this.toastTimer);
    if (message)
      this.toastTimer = setTimeout(() => {
        void this.model.dispatch({ type: "dismissMessage" });
      }, 7000);
  }

  private renderBotOptions(force = false): void {
    const state = this.model.state;
    const catalogChanged = this.renderedCatalog !== state.catalog;
    const selectionChanged = this.renderedSelection !== state.selectedBotIds;
    if (!force && !catalogChanged && !selectionChanged) return;

    const focusedId = document.activeElement?.id;
    this.renderedCatalog = state.catalog;
    this.renderedSelection = state.selectedBotIds;
    getElement("bot-list").innerHTML = renderBotSelection(state.catalog, state.selectedBotIds);
    this.bindBotOptionControls();
    if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });
    this.fitMapDimensions();
  }

  private bindBotOptionControls(): void {
    document.querySelectorAll<HTMLInputElement>(".bot-select").forEach((element) => {
      element.onchange = () => {
        void this.changeBotCopies(element.value, element.checked ? 1 : 0);
      };
    });
    document.querySelectorAll<HTMLInputElement>(".bot-copies").forEach((element) => {
      element.onchange = () => {
        void this.changeBotCopies(element.dataset.botId!, element.valueAsNumber);
      };
    });
  }

  private async changeBotCopies(botId: string, copies: number): Promise<void> {
    await this.model.dispatch({ type: "setBotCopies", botId, copies });
    this.renderBotOptions(true);
  }

  private fitMapDimensions() {
    const minimum = this.model.minimumMapDimension(
      getElement<HTMLSelectElement>("biome").value as GameConfig["biome"],
    );

    for (const id of ["width", "height"]) {
      input(id).min = String(minimum);
      if (Number(input(id).value) < minimum) input(id).value = String(minimum);
    }
  }
  private readGameConfigFromForm(): GameConfig {
    return {
      ...this.readWorldRules(),
      biome: getElement<HTMLSelectElement>("biome").value as GameConfig["biome"],
      width: Number(input("width").value),
      height: Number(input("height").value),
      ticks: Number(input("ticks").value),
      seed: input("seed").value,
      baseLayout: getElement<HTMLSelectElement>("layout").value as GameConfig["baseLayout"],
      resourceDensity: Number(input("resources").value) / 100,
      terrainDensity: Number(input("terrain").value) / 100,
      capacity: Number(input("capacity").value),
      decisionTimeoutMs: Number(input("timeout").value),
      hotspotCount: Number(input("hotspots").value),
      outpostCount: Number(input("outposts").value),
      captureTurns: Number(input("capture-turns").value),
      captureImmunityTicks: Number(input("capture-immunity").value),
      stealing: input("stealing").checked,
      stealCooldownTicks: Number(input("steal-cooldown").value),
    };
  }
  private readWorldRules() {
    return {
      sabotage: input("sabotage").checked,
      cargoTraps: input("cargo-traps").checked,
      naturalEvents: input("natural-events").checked,
      scavengerCount: Number(input("scavengers").value),
      guardianCount: Number(input("guardians").value),
    };
  }

  private matchRequest() {
    return {
      config: this.readGameConfigFromForm(),
      botIds: [...this.model.state.selectedBotIds],
    };
  }

  async generateMatch() {
    this.showTab("arena");
    await this.model.dispatch({ type: "generateMatch", request: this.matchRequest() });
  }

  private runTournament(): void {
    if (!this.model.state.canGenerate) return;
    this.model.playback.pause();
    this.showTab("tournament");
    const options = {
      winTarget: input("tournament-win-target").valueAsNumber,
      badges: this.badgeOptions(),
    };
    void this.tournament.run(this.matchRequest(), options, () => this.renderTournamentButton());
  }

  private renderTournamentButton(): void {
    const running = this.tournament.tournament.running;
    const run = button("run-tournament");
    run.disabled = running || !this.model.state.canGenerate;
    run.textContent = running ? "Tournament running…" : "Run tournament";
  }

  private showTab(active: CompetitionTab): void {
    this.activeTab = active;
    for (const tab of tabs) {
      const selected = tab === active;
      getElement(`panel-${tab}`).hidden = !selected;
      button(`tab-${tab}`).setAttribute("aria-pressed", String(selected));
    }
  }

  private renderFinalResults(refresh = false): void {
    const final = this.model.playback.finalSnapshot;
    const changed = this.renderedFinal !== final;
    if (!changed && !refresh) return;

    this.renderedFinal = final;
    getElement("match-results").innerHTML = final
      ? renderMatchResults(final, {
          badges: this.badgeOptions(),
          hiddenColumns: this.hiddenResultColumns,
        })
      : '<p class="muted">Finish a match to see its results.</p>';
    const viewingArena = this.activeTab === "arena";
    if (final && changed && viewingArena) this.showTab("results");
  }
  private badgeOptions() {
    return {
      standout: input("standout-badges").valueAsNumber,
      random: input("random-badges").valueAsNumber,
    };
  }

  private bindResultOptions(): void {
    const fields = getElement("result-columns");
    for (const name of configurableResultColumns) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.onchange = () => {
        if (checkbox.checked) this.hiddenResultColumns.delete(name);
        else this.hiddenResultColumns.add(name);
        this.renderFinalResults(true);
        this.tournament.setHiddenColumns(this.hiddenResultColumns);
      };
      label.append(checkbox, name);
      fields.append(label);
    }
    input("standout-badges").onchange = () => this.renderFinalResults(true);
    input("random-badges").onchange = () => this.renderFinalResults(true);
  }
  private renderControls() {
    const controls = this.model.playbackControls;
    button("play").disabled = !controls.canPlay;
    button("play").textContent = controls.playLabel;
    button("step").disabled = !controls.canStep;
    button("export").disabled = !controls.canExport;
    input("timeline").disabled = !controls.canSeek;
    input("timeline").max = String(controls.maxTick);
    input("timeline").value = String(controls.tick);
    getElement("playback-mode").hidden = !controls.isReplay;
  }
  private renderMatch() {
    const state = this.model.playback.snapshot;
    if (!state) {
      this.renderControls();
      return;
    }

    getElement("map-empty").hidden = true;
    getElement("competition-rules").textContent =
      `Capture: ${state.config.captureTurns} turns; immunity: ${state.config.captureImmunityTicks} following rounds. ${state.config.stealing ? `Theft cooldown: ${state.config.stealCooldownTicks} ticks. Both participants are protected for the following tick.` : "Cargo theft disabled."}`;
    getElement("map").setAttribute(
      "aria-label",
      `${BIOMES[state.config.biome].name} map with ${state.hotspots.length} hotspots and ${state.outposts.length} outposts`,
    );

    getElement("tick-label").textContent = `${state.tick} / ${state.config.ticks}`;
    getElement("standings").innerHTML = renderStandings(state);
    this.renderStatistics();
    getElement("event-log").innerHTML = renderEventLog(
      state.bots,
      this.model.playback.recentEvents(),
    );
    getElement("map-container").style.aspectRatio = `${state.map.width}/${state.map.height}`;
    this.renderControls();
    getElement("world-status").innerHTML = renderWorldStatus(state);
    this.mapView.update(state);
  }
  private renderStatistics(): void {
    const state = this.model.playback.snapshot;
    if (!state) return;

    const panel = getElement<HTMLDetailsElement>("bot-statistics");
    panel.hidden = false;
    if (!panel.open) return;

    const select = getElement<HTMLSelectElement>("statistics-bot");
    const options = renderStatisticsOptions(state.bots);
    if (this.renderedStatisticsOptions !== options) {
      this.renderedStatisticsOptions = options;
      const selected = state.bots.some((bot) => bot.id === select.value);
      const id = selected ? select.value : (state.bots[0]?.id ?? "");
      select.innerHTML = options;
      select.value = id;
    }
    getElement("bot-statistics-values").innerHTML = renderBotStatistics(state, select.value);
  }

  private renderBiomeDescription() {
    getElement("biome-description").textContent =
      BIOMES[this.biomeSelect.value as GameConfig["biome"]].description;
  }
  private initializeBiomeOptions(): void {
    for (const [id, biome] of Object.entries(BIOMES)) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = biome.name;
      this.biomeSelect.append(option);
    }

    this.biomeSelect.onchange = () => {
      this.renderBiomeDescription();
      this.fitMapDimensions();
    };
    this.renderBiomeDescription();
  }

  private observeMap(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.mapView.resize();
    });
    this.resizeObserver.observe(getElement("map-container"));
    this.detachTooltip = attachMapTooltip(
      this.canvas,
      getElement("map-tooltip"),
      () => this.model.playback.snapshot,
    );
    this.unsubscribe = this.model.subscribe(() => this.renderApplication());
  }

  private bindConfigEvents(): void {
    getElement("config-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if ((event as SubmitEvent).submitter === button("run-tournament")) this.runTournament();
      else void this.generateMatch();
    });
    button("shuffle").onclick = () => {
      input("seed").value = `field-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`;
    };
    button("refresh-bots").onclick = () => {
      void this.model.dispatch({ type: "refreshBots" });
    };

    for (const id of ["resources", "terrain"])
      input(id).oninput = () => {
        getElement(`${id}-value`).textContent = `${input(id).value}%`;
      };
  }

  private bindPlaybackEvents(): void {
    button("play").onclick = () => {
      void this.model.dispatch({
        type: "togglePlayback",
        getSpeed: () => Number(getElement<HTMLSelectElement>("speed").value),
      });
    };
    button("step").onclick = () => {
      void this.model.dispatch({ type: "stepPlayback" });
    };
    input("timeline").oninput = () => {
      void this.model.dispatch({ type: "seekPlayback", tick: Number(input("timeline").value) });
    };
  }

  private bindDialogs(): void {
    button("rules-button").onclick = () => getElement<HTMLDialogElement>("rules").showModal();
    button("close-rules").onclick = () => getElement<HTMLDialogElement>("rules").close();
    button("import").onclick = () => input("replay-file").click();
  }

  private bindReplayEvents(): void {
    input("replay-file").onchange = async () => {
      const file = input("replay-file").files?.[0];
      if (!file) return;

      this.showTab("arena");
      await this.model.dispatch({ type: "importReplay", file });
      input("replay-file").value = "";
    };
    button("export").onclick = () => {
      void this.model.dispatch({ type: "exportReplay", saveReplay: downloadReplay });
    };
  }
}

function downloadReplay(replay: Replay): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(replay)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `resource-hunt-${replay.initial.config.seed.replace(/[^a-z0-9-]/gi, "_")}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
