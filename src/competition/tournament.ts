import { defaultBadgeOptions, selectAwards, type BadgeOptions } from "./awards.ts";
import { compareTournamentStandings } from "./results.ts";
import { BIOMES } from "../engine/biomes.ts";
import { createMatchStatistics } from "../engine/match-statistics.ts";
import type { Biome, MatchResult, Standing } from "../engine/types.ts";
import type { CreateGameRequest, TournamentRound, TournamentRoundRequest } from "../http/types.ts";

export const tournamentBiomes = Object.keys(BIOMES) as Biome[];

export interface TournamentStanding extends Pick<
  Standing,
  "id" | "name" | "score" | "delivered" | "captures" | "stolen" | "lost" | "errors" | "statistics"
> {
  wins: number;
  badges: number;
}

export interface TournamentOptions {
  winTarget: number;
  badges: BadgeOptions;
}

export class Tournament {
  readonly rounds: TournamentRound[] = [];
  winners: string[] = [];
  error = "";
  currentBiome?: Biome;
  private runController?: AbortController;

  constructor(
    private client: {
      tournamentRound(
        request: TournamentRoundRequest,
        signal: AbortSignal,
      ): Promise<TournamentRound>;
    },
  ) {}

  get running(): boolean {
    return !!this.runController;
  }

  async run(
    request: CreateGameRequest,
    options: TournamentOptions,
    onChange: () => void,
  ): Promise<void> {
    if (this.running) return;
    const controller = new AbortController();
    this.runController = controller;
    this.rounds.length = 0;
    this.winners = [];
    this.error = "";
    try {
      await this.runRounds(request, options.winTarget, { onChange, signal: controller.signal });
    } catch (error) {
      if (!controller.signal.aborted) this.error = String(error);
    } finally {
      this.runController = undefined;
      this.currentBiome = undefined;
      if (!controller.signal.aborted) onChange();
    }
  }

  private async runRounds(
    request: CreateGameRequest,
    winTarget: number,
    run: { onChange: () => void; signal: AbortSignal },
  ) {
    const integerTarget = Number.isInteger(winTarget);
    const validTarget = integerTarget ? winTarget >= 1 && winTarget <= 10 : false;
    if (!validTarget) throw new Error("Choose a win target from 1 to 10");

    const wins = new Map<string, number>();
    const start = tournamentBiomes.indexOf(request.config.biome);
    while (!this.winners.length) {
      const roundIndex = this.rounds.length;
      const biome = tournamentBiomes[(start + roundIndex) % tournamentBiomes.length]!;
      this.currentBiome = biome;
      run.onChange();
      const suffix = roundIndex < tournamentBiomes.length ? "" : `:${roundIndex + 1}`;
      const seed = request.config.seed.slice(0, 200 - suffix.length) + suffix;
      const round = await this.client.tournamentRound(
        { ...request, config: { ...request.config, biome, seed }, roundIndex },
        run.signal,
      );
      if (run.signal.aborted) return;
      this.rounds.push(round);
      this.winners = roundWinners(round.result, wins, winTarget);
    }
  }

  dispose(): void {
    this.runController?.abort();
  }
}

function roundWinners(result: MatchResult, wins: Map<string, number>, target: number): string[] {
  const winners: string[] = [];
  for (const row of result.standings) {
    if (row.rank !== 1) continue;
    const count = (wins.get(row.id) ?? 0) + 1;
    wins.set(row.id, count);
    if (count >= target) winners.push(row.name);
  }
  return winners;
}

export function summarizeTournament(
  rounds: Iterable<TournamentRound>,
  badges = defaultBadgeOptions,
): TournamentStanding[] {
  const totals = new Map<string, TournamentStanding>();
  for (const { result } of rounds) {
    for (const row of result.standings) {
      const total = totals.get(row.id) ?? createTotal(row);
      addRound(total, row);
      totals.set(row.id, total);
    }
    addRoundAwards(totals, result, badges);
  }

  return [...totals.values()].sort(compareTournamentStandings);
}

function addRoundAwards(
  totals: Map<string, TournamentStanding>,
  result: MatchResult,
  badges: BadgeOptions,
): void {
  const { prominent, extras } = selectAwards(result.standings, result.config.seed, badges);
  for (const award of [...prominent, ...extras]) {
    for (const { id } of award.winners) totals.get(id)!.badges++;
  }
}

function createTotal(row: Standing): TournamentStanding {
  return {
    id: row.id,
    name: row.name,
    score: 0,
    delivered: 0,
    captures: 0,
    stolen: 0,
    lost: 0,
    errors: 0,
    wins: 0,
    badges: 0,
    statistics: createMatchStatistics(),
  };
}

function addRound(total: TournamentStanding, row: Standing): void {
  total.score += row.score;
  total.delivered += row.delivered;
  total.captures += row.captures;
  total.stolen += row.stolen;
  total.lost += row.lost;
  total.errors += row.errors;
  total.wins += Number(row.rank === 1);
  const statistics = total.statistics!;
  for (const key of Object.keys(statistics) as (keyof typeof statistics)[]) {
    statistics[key] += row.statistics?.[key] ?? 0;
  }
}

export function scoresAtTick(round: TournamentRound, tick: number) {
  const scores = round.scores[tick];
  if (!scores) throw new Error(`Choose a tick from 0 to ${round.result.ticks}`);

  return round.result.botOrder
    .map((id, index) => {
      const row = round.result.standings.find((standing) => standing.id === id)!;
      return { id, name: row.name, score: scores[index]! };
    })
    .sort((first, second) => second.score - first.score);
}

export interface TournamentReport {
  badges?: ReturnType<typeof selectAwards>;
  options: TournamentOptions;
  winners: string[];
  standings: TournamentStanding[];
  rounds: TournamentRound[];
}

export function tournamentReport(
  tournament: Tournament,
  options: TournamentOptions,
  seed: string,
): TournamentReport {
  const { rounds, winners } = tournament;
  const standings = summarizeTournament(rounds, options.badges);
  return {
    options,
    standings,
    winners,
    rounds,
    badges: selectAwards(standings, seed, options.badges),
  };
}
