import { BIOMES } from "../../engine/biomes.ts";
import type { CreateGameRequest, TournamentRound } from "../../http/types.ts";
import {
  scoresAtTick,
  summarizeTournament,
  Tournament,
  type TournamentOptions,
} from "../../competition/tournament.ts";
import { renderResults, renderScoreProgress } from "./results.ts";

export class TournamentView {
  private options?: TournamentOptions;
  private seed = "";
  private hiddenColumns = new Set<string>();
  private displayedRound?: TournamentRound;
  private biome = document.querySelector<HTMLSelectElement>("#tournament-biome")!;
  private tick = document.querySelector<HTMLInputElement>("#tournament-tick")!;
  private summary = document.querySelector<HTMLElement>("#tournament-summary")!;
  private progress = document.querySelector<HTMLElement>("#tournament-status")!;
  private scores = document.querySelector<HTMLElement>("#tournament-scores")!;
  private roundResults = document.querySelector<HTMLElement>("#tournament-round-results")!;

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

  private render(): void {
    if (!this.options) return;

    const { rounds, winners } = this.tournament;
    this.progress.textContent = this.describeProgress(this.options.winTarget);
    const mode = winners.length ? "tournament" : "in-progress";
    const options = {
      mode,
      badges: this.options.badges,
      hiddenColumns: this.hiddenColumns,
    } as const;
    const standings = summarizeTournament(rounds, options.badges);
    this.summary.innerHTML = rounds.length ? renderResults(standings, this.seed, options) : "";

    for (let index = this.biome.options.length; index < rounds.length; index++) {
      const biome = rounds[index]!.result.config.biome;
      this.biome.add(new Option(`Round ${index + 1} · ${BIOMES[biome].name}`, String(index)));
    }
    this.biome.disabled = !rounds.length;
    const changed = this.selectedRound !== this.displayedRound;
    const empty = !rounds.length;
    if (changed || empty) this.renderRound();
  }

  private describeProgress(target: number): string {
    const { rounds, currentBiome, winners, error } = this.tournament;
    if (error) return error;
    if (winners.length)
      return `${winners.join(", ")} reached ${target} ${target === 1 ? "win" : "wins"} · ${rounds.length} rounds played`;
    if (currentBiome)
      return `Round ${rounds.length + 1} · ${BIOMES[currentBiome].name} · target ${target} wins`;
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
    this.scores.innerHTML = `<p>Tick ${tick} / ${round.result.ticks}</p>${renderScoreProgress(rows)}`;
  }
}
