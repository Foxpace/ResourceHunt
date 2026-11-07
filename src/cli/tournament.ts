import { tournamentReport, Tournament, type TournamentReport } from "../competition/tournament.ts";
import { BIOMES } from "../engine/biomes.ts";
import type { GameConfig } from "../engine/types.ts";
import type { BotDescriptor } from "../runtime/bots.ts";
import { runTournamentRound } from "../runtime/tournament-round.ts";
import { integerFlag } from "./options.ts";
import { badgeOptionsFromFlags, printBadges, printStandings } from "./results.ts";

export async function runCliTournament(
  bots: BotDescriptor[],
  config: GameConfig,
  flags: ReadonlyMap<string, string>,
) {
  const options = {
    winTarget: integerFlag(flags, "wins", { min: 1, max: 10, fallback: 3 }),
    badges: badgeOptionsFromFlags(flags),
  };
  const tournament = createCliTournament(bots);

  await tournament.run({ config, botIds: bots.map((bot) => bot.id) }, options, () => {
    if (!flags.has("json")) printTournamentProgress(tournament);
  });
  if (tournament.error) throw new Error(tournament.error);

  const payload = tournamentReport(tournament, options, config.seed);
  if (!flags.has("json")) printTournamentReport(payload, flags);
  return { payload, hasBotErrors: payload.standings.some((row) => row.errors > 0) };
}

function printTournamentProgress(tournament: Tournament): void {
  const lastRound = tournament.rounds.at(-1);
  if (lastRound) {
    const scores = lastRound.result.standings
      .map(({ name, score }) => `${name} ${score}`)
      .join(" · ");
    console.error(`Round ${tournament.rounds.length} scores · ${scores}`);
  }
  const biome = tournament.currentBiome;
  if (biome) console.error(`Round ${tournament.rounds.length + 1} · ${BIOMES[biome].name}`);
}

function createCliTournament(bots: BotDescriptor[]): Tournament {
  return new Tournament({
    tournamentRound(request, signal) {
      return runTournamentRound(bots, request, signal);
    },
  });
}

function printTournamentReport(report: TournamentReport, flags: ReadonlyMap<string, string>): void {
  console.log(
    `${report.winners.join(", ")} reached ${report.options.winTarget} wins · ${report.rounds.length} rounds played`,
  );
  printStandings(report.standings, flags);
  if (report.badges) printBadges(report.badges);
}
