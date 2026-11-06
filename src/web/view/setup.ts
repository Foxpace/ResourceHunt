import { BIOMES } from "../../engine/biomes.ts";
import { MAX_BOTS, type GameConfig } from "../../engine/types.ts";
import type { ApplicationModel } from "../model/application.ts";
import { BiomePicker } from "./biome-picker.ts";
import { renderBotSelection } from "./panels.ts";

export type CompetitionMode = "match" | "tournament";

const getElement = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const input = (id: string) => getElement<HTMLInputElement>(id);

/** Setup rail: mode, battlefield, contenders, rules, and the launch button. */
export class SetupForm {
  private biomePicker: BiomePicker;

  constructor(private model: ApplicationModel) {
    this.biomePicker = new BiomePicker(getElement("biome-picker"), () => this.onBiomeChange());
    this.bindFields();
    this.bindCollapse();
    this.onBiomeChange();
  }

  get mode(): CompetitionMode {
    const checked = document.querySelector<HTMLInputElement>('input[name="mode"]:checked');
    return checked?.value === "tournament" ? "tournament" : "match";
  }

  get winTarget(): number {
    return input("tournament-win-target").valueAsNumber;
  }

  setMode(mode: CompetitionMode): void {
    const option = document.querySelector<HTMLInputElement>(`input[name="mode"][value="${mode}"]`);
    if (option) option.checked = true;

    document.body.dataset.mode = mode;
    this.renderLaunchSummary();
  }

  setCollapsed(collapsed: boolean): void {
    document.body.classList.toggle("setup-hidden", collapsed);
    getElement("collapse-setup").setAttribute("aria-expanded", String(!collapsed));
    getElement("expand-setup").setAttribute("aria-expanded", String(!collapsed));
  }

  dispose(): void {
    this.biomePicker.dispose();
  }

  readConfig(): GameConfig {
    return {
      ...this.readWorldRules(),
      biome: this.biomePicker.value,
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

  /** Re-renders the roster and every value derived from the lineup. */
  renderLineup(): void {
    const { catalog, selectedBotIds } = this.model.state;
    const focusedId = document.activeElement?.id;
    getElement("bot-list").innerHTML = renderBotSelection(catalog, selectedBotIds);
    this.bindRosterControls();
    if (focusedId) document.getElementById(focusedId)?.focus({ preventScroll: true });

    const count = getElement("selected-count");
    count.textContent = `${selectedBotIds.length}/${MAX_BOTS}`;
    count.classList.toggle("over-limit", selectedBotIds.length > MAX_BOTS);
    this.fitMapDimensions();
    this.renderLaunchSummary();
  }

  renderLaunchSummary(): void {
    const config = this.readConfig();
    const bots = this.model.state.selectedBotIds.length;
    const parts = [
      `${bots} ${bots === 1 ? "bot" : "bots"}`,
      this.mode === "tournament" ? `from ${BIOMES[config.biome].name}` : BIOMES[config.biome].name,
      `${config.width}×${config.height}`,
      `${config.ticks} ticks`,
    ];
    getElement("launch-summary").textContent = bots ? parts.join(" · ") : "Add at least one bot";
    this.biomePicker.schedulePreviews({ config, botCount: Math.max(1, Math.min(MAX_BOTS, bots)) });
  }

  private bindRosterControls(): void {
    document.querySelectorAll<HTMLInputElement>(".bot-select").forEach((element) => {
      element.onchange = () => this.changeBotCopies(element.value, element.checked ? 1 : 0);
    });
    document.querySelectorAll<HTMLInputElement>(".bot-copies").forEach((element) => {
      element.onchange = () => this.changeBotCopies(element.dataset.botId!, element.valueAsNumber);
    });
    document.querySelectorAll<HTMLButtonElement>(".bot-step").forEach((element) => {
      element.onclick = () => {
        const botId = element.dataset.botId!;
        const current = this.model.state.selectedBotIds.filter((id) => id === botId).length;
        this.changeBotCopies(botId, current + Number(element.dataset.delta));
      };
    });
  }

  private changeBotCopies(botId: string, copies: number): void {
    void this.model
      .dispatch({ type: "setBotCopies", botId, copies })
      .then(() => this.renderLineup());
  }

  private onBiomeChange(): void {
    getElement("biome-description").textContent = BIOMES[this.biomePicker.value].description;
    this.fitMapDimensions();
    this.renderLaunchSummary();
  }

  private fitMapDimensions(): void {
    const minimum = this.model.minimumMapDimension(this.biomePicker.value);
    for (const id of ["width", "height"]) {
      input(id).min = String(minimum);
      if (Number(input(id).value) < minimum) input(id).value = String(minimum);
    }
  }

  private bindFields(): void {
    getElement("shuffle").onclick = () => {
      input("seed").value = `field-${crypto.getRandomValues(new Uint32Array(1))[0]!.toString(36)}`;
      this.renderLaunchSummary();
    };
    for (const id of ["resources", "terrain"])
      input(id).addEventListener("input", () => {
        getElement(`${id}-value`).textContent = `${input(id).value}%`;
      });

    const form = getElement("config-form");
    form.addEventListener("input", () => this.renderLaunchSummary());
    form.addEventListener("change", (event) => {
      const target = event.target as HTMLInputElement;
      if (target.name === "mode") this.setMode(this.mode);
    });
  }

  private bindCollapse(): void {
    getElement("collapse-setup").onclick = () => this.setCollapsed(true);
    getElement("expand-setup").onclick = () => this.setCollapsed(false);
  }
}
