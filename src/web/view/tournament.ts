import { BIOMES } from "../../engine/biomes.ts";
import type { CreateGameRequest, TournamentRound } from "../../http/types.ts";
import {
  scoresAtTick,
  summarizeTournament,
  Tournament,
  type TournamentOptions,
} from "../../competition/tournament.ts";
import { colorsByOrder, renderResults, renderScoreProgress } from "./results.ts";
import { escapeHtml } from "./panels.ts";

const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;

export class TournamentView {
  private options?: TournamentOptions;
  private seed = "";
  private hiddenColumns = new Set<string>();
  private displayedRound?: TournamentRound;
  private biome = element<HTMLSelectElement>("#tournament-biome");
  private tick = element<HTMLInputElement>("#tournament-tick");
  private summary = element<HTMLElement>("#tournament-summary");
  private progress = element<HTMLElement>("#tournament-status");
  private scores = element<HTMLElement>("#tournament-scores");
  private roundResults = element<HTMLElement>("#tournament-round-results");
  private roundTrack = element<HTMLElement>("#round-track");

  constructor(readonly tournament: Tournament) {
    this.biome.onchange = () => this.renderRound();
    this.tick.oninput = () => this.renderScores();
  }

  run(request: CreateGameRequest, options: TournamentOptions, onChange: () => void): Promise<void> {
    if (this.tournament.running) return Promise.resolve();

    this.options = options;
    this.seed = request.config.seed;
    this.displayedRound = undefined;
    this.biome.replaceChildren();
    return this.tournament.run(request, options, () => {
      this.render();
      onChange();
    });
  }

  setHiddenColumns(columns: Set<string>): void {
    this.hiddenColumns = columns;
    this.render();
    this.renderRoundResults();
  }

  private get colors(): Map<string, string> {
    return colorsByOrder(this.tournament.rounds[0]?.result.botOrder ?? []);
  }

  private render(): void {
    if (!this.options) return;

    const { rounds, winners } = this.tournament;
    this.progress.textContent = this.describeProgress(this.options.winTarget);
    element("#tournament-empty").hidden = true;
    element("#round-explorer").hidden = !rounds.length;
    this.roundTrack.innerHTML = this.renderRoundTrack();
    const mode = winners.length ? "tournament" : "in-progress";
    const options = {
      mode,
      badges: this.options.badges,
      hiddenColumns: this.hiddenColumns,
      colors: this.colors,
    } as const;
    const standings = summarizeTournament(rounds, options.badges);
    this.summary.innerHTML = rounds.length ? renderResults(standings, this.seed, options) : "";
    this.renderRoundOptions();
  }

  private renderRoundOptions(): void {
    const { rounds } = this.tournament;
    for (let index = this.biome.options.length; index < rounds.length; index++) {
      const biome = rounds[index]!.result.config.biome;
      this.biome.add(new Option(`Round ${index + 1} · ${BIOMES[biome].name}`, String(index)));
    }
    this.biome.disabled = !rounds.length;
    const changed = this.selectedRound !== this.displayedRound;
    const empty = !rounds.length;
    if (changed || empty) this.renderRound();
  }

  private renderRoundTrack(): string {
    const colors = this.colors;
    const played = this.tournament.rounds.map((round, index) => {
      const winners = round.result.standings.filter((row) => row.rank === 1);
      const dots = winners
        .map((row) => `<i style="--bot-color:${colors.get(row.id) ?? "#c9eca1"}"></i>`)
        .join("");
      const names = winners.map((row) => escapeHtml(row.name)).join(", ");
      return `<li class="round-chip is-done" title="Round ${index + 1} won by ${names}">
        <span>R${index + 1}</span><b>${BIOMES[round.result.config.biome].name}</b><em>${dots}${names}</em></li>`;
    });
    const current = this.tournament.currentBiome;
    const live = current
      ? `<li class="round-chip is-live"><span>R${played.length + 1}</span><b>${BIOMES[current].name}</b><em>Simulating…</em></li>`
      : "";

    return played.join("") + live;
  }

  private describeProgress(target: number): string {
    const { rounds, currentBiome, winners, error } = this.tournament;
    if (error) return error;
    if (winners.length)
      return `${winners.join(", ")} reached ${target} ${target === 1 ? "win" : "wins"} · ${rounds.length} rounds played`;
    if (currentBiome)
      return `Round ${rounds.length + 1} · ${BIOMES[currentBiome].name} · first to ${target} ${target === 1 ? "win" : "wins"}`;
    return "";
  }

  private get selectedRound(): TournamentRound | undefined {
    return this.tournament.rounds[this.biome.selectedIndex];
  }

  private renderRound(): void {
    const round = this.selectedRound;
    this.displayedRound = round;
    this.tick.disabled = !round;
    this.tick.max = String(round?.result.ticks ?? 0);
    this.tick.value = this.tick.max;
    this.renderRoundResults();
    this.renderScores();
  }

  private renderRoundResults(): void {
    const round = this.selectedRound;
    this.roundResults.innerHTML = round
      ? renderResults(round.result.standings, round.result.config.seed, {
          badges: this.options?.badges,
          hiddenColumns: this.hiddenColumns,
          colors: colorsByOrder(round.result.botOrder),
          podium: false,
        })
      : "";
  }

  private renderScores(): void {
    const round = this.selectedRound;
    if (!round) {
      this.scores.replaceChildren();
      return;
    }

    const tick = Number(this.tick.value);
    const rows = scoresAtTick(round, tick);
    const colors = colorsByOrder(round.result.botOrder);
    this.scores.innerHTML = `<p class="tick-note">Tick ${tick} / ${round.result.ticks}</p>${renderScoreProgress(rows, colors)}`;
  }
}
