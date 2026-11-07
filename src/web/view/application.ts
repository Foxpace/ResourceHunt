import type { Snapshot } from "../../engine/types.ts";
import { configurableResultColumns, renderMatchResults } from "./results.ts";
import { TournamentView } from "./tournament.ts";
import { AnimatedMapView } from "./animated-map.ts";
import { renderWorldStatus } from "./world-status.ts";
import { BIOMES } from "../../engine/biomes.ts";
import {
  renderStandings,
  renderEventLog,
  renderBotStatistics,
  renderStatisticsOptions,
} from "./panels.ts";
import { ApplicationModel } from "../model/application.ts";
import { attachMapTooltip } from "./map.ts";
import { type Replay, type BotMetadata } from "../../engine/types.ts";
import { SetupForm } from "./setup.ts";
import { ArenaOverlays } from "./arena-overlays.ts";
import { BIOME_AMBIENCE } from "./terrain-palette.ts";

const getElement = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => getElement<HTMLInputElement>(id);
const tabs = ["arena", "results", "tournament"] as const;
type CompetitionTab = (typeof tabs)[number];
const button = (id: string) => getElement<HTMLButtonElement>(id);
const EMPTY_RESULTS = `<div class="empty-state"><svg aria-hidden="true"><use href="#i-sliders" /></svg>
  <h3>No results yet</h3><p>Finish a match to see the podium, standings, and badges.</p></div>`;

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
  private overlays = new ArenaOverlays();
  private setup: SetupForm;
  private resizeObserver!: ResizeObserver;
  private unsubscribe!: () => void;
  private detachTooltip!: () => void;

  constructor(
    private model: ApplicationModel,
    private tournament: TournamentView,
  ) {
    for (const tab of tabs) button(`tab-${tab}`).onclick = () => this.showTab(tab);
    this.setup = new SetupForm(model);
    this.observeMap();
    this.bindConfigEvents();
    this.bindResultOptions();
    this.bindPlaybackEvents();
    this.bindOverlayEvents();
    this.bindDialogs();
    getElement<HTMLDetailsElement>("bot-statistics").ontoggle = () => this.renderStatistics();
    getElement<HTMLSelectElement>("statistics-bot").onchange = () => this.renderStatistics();
    this.bindReplayEvents();
    this.renderFinalResults(true);
  }

  dispose(): void {
    clearTimeout(this.toastTimer);
    this.resizeObserver.disconnect();
    this.mapView.dispose();
    this.setup.dispose();
    this.tournament.tournament.dispose();
    this.unsubscribe();
    this.detachTooltip();
    document.removeEventListener("keydown", this.onKeyDown);
  }

  private renderApplication() {
    const state = this.model.state;
    this.renderBotOptions();

    button("refresh-bots").disabled = state.refreshing;
    button("generate").disabled = !state.canGenerate;
    this.renderTournamentButton();
    getElement("generate").querySelector("span")!.textContent = state.generating
      ? "Creating…"
      : "Create match";

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

  private renderBotOptions(): void {
    const state = this.model.state;
    const catalogChanged = this.renderedCatalog !== state.catalog;
    const selectionChanged = this.renderedSelection !== state.selectedBotIds;
    if (!catalogChanged && !selectionChanged) return;

    this.renderedCatalog = state.catalog;
    this.renderedSelection = state.selectedBotIds;
    this.setup.renderLineup();
  }

  private matchRequest() {
    return {
      config: this.setup.readConfig(),
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
    const options = { winTarget: this.setup.winTarget, badges: this.badgeOptions() };
    void this.tournament.run(this.matchRequest(), options, () => this.renderTournamentButton());
  }

  private renderTournamentButton(): void {
    const tournamentRunning = this.tournament.tournament.running;
    const tournamentButton = button("run-tournament");
    tournamentButton.disabled = tournamentRunning || !this.model.state.canGenerate;
    tournamentButton.querySelector("span")!.textContent = tournamentRunning
      ? "Tournament running…"
      : "Start tournament";
    const tournamentTabHidden = this.activeTab !== "tournament";
    const hasCompletedRounds = this.tournament.tournament.rounds.length > 0;
    if (tournamentTabHidden && hasCompletedRounds)
      button("tab-tournament").classList.add("has-news");
  }

  private showTab(active: CompetitionTab): void {
    this.activeTab = active;
    document.body.dataset.view = active;
    for (const tab of tabs) {
      const selected = tab === active;
      getElement(`panel-${tab}`).hidden = !selected;
      button(`tab-${tab}`).setAttribute("aria-pressed", String(selected));
    }
    button(`tab-${active}`).classList.remove("has-news");
    if (active === "arena") this.mapView.resize();
  }

  private renderFinalResults(forceRefresh = false): void {
    const finalSnapshot = this.model.playback.finalSnapshot;
    const finalSnapshotChanged = this.renderedFinal !== finalSnapshot;
    if (!finalSnapshotChanged && !forceRefresh) return;

    this.renderedFinal = finalSnapshot;
    getElement("match-results").innerHTML = finalSnapshot
      ? renderMatchResults(finalSnapshot, {
          badges: this.badgeOptions(),
          hiddenColumns: this.hiddenResultColumns,
        })
      : EMPTY_RESULTS;
    const resultsTabHidden = this.activeTab !== "results";
    const hasNewFinalResults = !!finalSnapshot && finalSnapshotChanged;
    if (resultsTabHidden && hasNewFinalResults) button("tab-results").classList.add("has-news");
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
      label.className = "switch";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = true;
      checkbox.onchange = () => {
        if (checkbox.checked) this.hiddenResultColumns.delete(name);
        else this.hiddenResultColumns.add(name);
        this.renderFinalResults(true);
        this.tournament.setHiddenColumns(this.hiddenResultColumns);
      };
      label.append(checkbox, document.createElement("i"), name);
      fields.append(label);
    }
    input("standout-badges").onchange = () => this.renderFinalResults(true);
    input("random-badges").onchange = () => this.renderFinalResults(true);
  }

  private renderControls() {
    const controls = this.model.playbackControls;
    const play = button("play");
    play.disabled = !controls.canPlay;
    play.querySelector("span")!.textContent = controls.playLabel;
    const icon = { Pause: "#i-pause", Replay: "#i-replay" }[controls.playLabel] ?? "#i-play";
    play.querySelector("use")!.setAttribute("href", icon);
    play.classList.toggle("is-playing", this.model.playback.isPlaying);
    button("step").disabled = !controls.canStep;
    button("stop-match").disabled = !controls.canStop;
    button("export").disabled = !controls.canExport;
    const timeline = input("timeline");
    timeline.disabled = !controls.canSeek;
    timeline.max = String(controls.maxTick);
    timeline.value = String(controls.tick);
    timeline.style.setProperty(
      "--progress",
      `${(controls.tick / Math.max(1, controls.maxTick)) * 100}%`,
    );
    const mode = getElement("playback-mode");
    mode.hidden = !controls.status;
    if (mode.textContent !== controls.status) mode.textContent = controls.status;
    this.renderOverlays();
  }

  private renderOverlays(): void {
    const controls = this.model.playbackControls;
    const playback = this.model.playback;
    const state = {
      snapshot: playback.snapshot,
      playing: playback.isPlaying,
      canPlay: controls.canPlay,
      isReplay: controls.isReplay,
    };
    this.overlays.render(state, playback.finalSnapshot);
  }

  private renderMatch() {
    const state = this.model.playback.snapshot;
    if (!state) {
      this.renderControls();
      return;
    }

    getElement("map-empty").hidden = true;
    this.renderMatchContext(state);
    getElement("tick-label").textContent = `${state.tick} / ${state.config.ticks}`;
    getElement("standings").innerHTML = renderStandings(state);
    this.renderStatistics();
    getElement("event-log").innerHTML = renderEventLog(
      state.bots,
      this.model.playback.recentEvents(),
    );
    this.renderControls();
    getElement("world-status").innerHTML = renderWorldStatus(state);
    this.mapView.update(state);
  }

  private renderMatchContext(state: Snapshot): void {
    const { config } = state;
    getElement("competition-rules").textContent =
      `Capture: ${config.captureTurns} turns; immunity: ${config.captureImmunityTicks} following rounds. ${config.stealing ? `Theft cooldown: ${config.stealCooldownTicks} ticks. Both participants are protected for the following tick.` : "Cargo theft disabled."}`;
    getElement("map").setAttribute(
      "aria-label",
      `${BIOMES[config.biome].name} map with ${state.hotspots.length} hotspots and ${state.outposts.length} outposts`,
    );
    getElement("map-container").style.setProperty(
      "--map-aspect",
      `${state.map.width / state.map.height}`,
    );
    document.body.style.setProperty("--ambience", BIOME_AMBIENCE[config.biome]);
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

  private observeMap(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.mapView.resize();
    });
    this.resizeObserver.observe(getElement("map-container"));
    this.detachTooltip = attachMapTooltip({
      canvas: this.canvas,
      tooltip: getElement("map-tooltip"),
      getSnapshot: () => this.model.playback.snapshot,
      onHover: (cell) => this.mapView.setHover(cell),
    });
    this.unsubscribe = this.model.subscribe(() => this.renderApplication());
  }

  private bindConfigEvents(): void {
    getElement("config-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (!this.model.state.canGenerate) return;

      this.setup.setCollapsed(true);
      if (this.setup.mode === "tournament") this.runTournament();
      else void this.generateMatch();
    });
    button("refresh-bots").onclick = () => {
      void this.model.dispatch({ type: "refreshBots" });
    };
    button("tournament-setup").onclick = () => {
      this.setup.setMode("tournament");
      this.setup.setCollapsed(false);
      getElement("step-tournament").scrollIntoView({ behavior: "smooth", block: "center" });
      input("tournament-win-target").focus({ preventScroll: true });
    };
  }

  private togglePlayback(): void {
    void this.model.dispatch({
      type: "togglePlayback",
      getSpeed: () =>
        Number(document.querySelector<HTMLInputElement>('input[name="speed"]:checked')?.value ?? 8),
    });
  }

  private bindPlaybackEvents(): void {
    button("play").onclick = () => this.togglePlayback();
    button("ready-play").onclick = () => this.togglePlayback();
    button("step").onclick = () => {
      void this.model.dispatch({ type: "stepPlayback" });
    };
    button("stop-match").onclick = () => {
      void this.model.dispatch({ type: "stopMatch" });
    };
    input("timeline").oninput = () => {
      void this.model.dispatch({ type: "seekPlayback", tick: Number(input("timeline").value) });
    };
    document.addEventListener("keydown", this.onKeyDown);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    const targetIsInteractive = target.matches(
      "input, select, textarea, button, summary, a, [contenteditable]",
    );
    const modifierPressed = event.metaKey || event.ctrlKey || event.altKey;
    const arenaTabActive = this.activeTab === "arena";
    if (targetIsInteractive || modifierPressed || !arenaTabActive) return;

    const control = { " ": button("play"), ArrowRight: button("step") }[event.key];
    const controlEnabled = !!control && !control.disabled;
    if (!controlEnabled) return;

    event.preventDefault();
    control.click();
  };

  private bindOverlayEvents(): void {
    button("finish-results").onclick = () => {
      this.overlays.dismissFinish(this.model.playback.finalSnapshot);
      this.showTab("results");
    };
    button("finish-close").onclick = () => {
      this.overlays.dismissFinish(this.model.playback.finalSnapshot);
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
