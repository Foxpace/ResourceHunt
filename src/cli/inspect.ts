import { matchRows } from "../competition/results.ts";
import { getHazardMap } from "../engine/world/hazard-map.ts";
import { renderTerminalMap } from "./map.ts";
import { readFile } from "node:fs/promises";
import { selectAwards } from "../competition/awards.ts";
import { scoresAtTick, type TournamentReport } from "../competition/tournament.ts";
import { parseReplay } from "../engine/replay.ts";
import { integerFlag } from "./options.ts";
import { badgeOptionsFromFlags, printBadges, printStandings } from "./results.ts";

export async function inspectResults(flags: ReadonlyMap<string, string>) {
  const data: unknown = JSON.parse(await readFile(flags.get("input")!, "utf8"));
  if (isTournamentReport(data)) return inspectTournament(data, flags);
  return inspectReplay(data, flags);
}

function isTournamentReport(data: unknown): data is TournamentReport {
  if (!data) return false;
  if (typeof data !== "object") return false;
  if (!("rounds" in data)) return false;

  return Array.isArray(data.rounds);
}

function inspectTournament(report: TournamentReport, flags: ReadonlyMap<string, string>) {
  if (flags.has("map")) throw new Error("Tournament reports contain score history only");
  if (["round", "biome", "tick"].some((key) => flags.has(key))) return inspectRound(report, flags);

  const standings = filterBot(report.standings, flags);
  const seed = report.rounds[0]?.result.config.seed ?? "";
  const badges = selectAwards(
    report.standings,
    seed,
    badgeOptionsFromFlags(flags, report.options?.badges),
  );
  if (!flags.has("json")) {
    console.log(
      `${report.winners.join(", ")} reached the win target · ${report.rounds.length} rounds played`,
    );
    printStandings(standings, flags);
    printBadges(badges);
  }
  return { options: report.options, winners: report.winners, standings, badges };
}

function inspectRound(report: TournamentReport, flags: ReadonlyMap<string, string>) {
  const round = findRound(report, flags);
  const { config, ticks } = round.result;
  const tick = integerFlag(flags, "tick", { min: 0, max: ticks, fallback: ticks });
  const scores = scoresAtTick(round, tick);
  const standings = filterBot(tick === ticks ? round.result.standings : scores, flags);
  const badges =
    tick === ticks
      ? selectAwards(
          round.result.standings,
          config.seed,
          badgeOptionsFromFlags(flags, report.options?.badges),
        )
      : undefined;
  if (!flags.has("json")) {
    console.log(
      `Round ${report.rounds.indexOf(round) + 1} · ${config.biome} · tick ${tick}/${ticks}`,
    );
    if (tick === ticks) printStandings(standings, flags);
    else console.table(standings);
    if (badges) printBadges(badges);
  }
  return { config, tick, standings, badges };
}

function findRound(report: TournamentReport, flags: ReadonlyMap<string, string>) {
  const biome = flags.get("biome");
  const roundNumber = flags.get("round");
  const biomeSelected = Boolean(biome);
  const roundSelected = Boolean(roundNumber);
  if (biomeSelected && roundSelected) throw new Error("Choose either --round or --biome");
  if (biome) {
    const matches = report.rounds.filter(({ result }) => result.config.biome === biome);
    if (!matches.length) throw new Error(`No completed round for biome ${biome}`);
    if (matches.length > 1)
      throw new Error(`Biome ${biome} was played more than once. Select it with --round.`);
    return matches[0]!;
  }
  const last = report.rounds.length;
  if (!last) throw new Error("The tournament has no completed rounds");
  return report.rounds[integerFlag(flags, "round", { min: 1, max: last, fallback: last }) - 1]!;
}

function inspectReplay(data: unknown, flags: ReadonlyMap<string, string>) {
  const selectingRound = flags.has("round") || flags.has("biome");
  if (selectingRound) throw new Error("--round and --biome require a tournament report");
  const replay = parseReplay(data);
  const config = replay.initial.config;
  const tick = integerFlag(flags, "tick", {
    min: 0,
    max: replay.frames.length,
    fallback: replay.frames.length,
  });
  const frame = tick === 0 ? replay.initial : replay.frames[tick - 1]!;
  const rows = matchRows(frame);
  const standings = filterBot(rows, flags);
  const badges = frame.finished
    ? selectAwards(rows, config.seed, badgeOptionsFromFlags(flags))
    : undefined;
  const map = flags.has("map")
    ? renderTerminalMap(frame, getHazardMap(replay.initial.map, frame.world, tick))
    : undefined;
  if (!flags.has("json")) {
    console.log(`${config.biome} · tick ${tick}/${config.ticks}`);
    if (map) console.log(map);
    for (const event of frame.events) console.log(`  ${event.botId} · ${event.message}`);
    printStandings(standings, flags);
    if (badges) printBadges(badges);
  }
  return { config, tick, standings, badges, events: frame.events, map };
}

function filterBot<T extends { id: string }>(rows: T[], flags: ReadonlyMap<string, string>): T[] {
  const id = flags.get("bot");
  if (!id) return rows;
  const matching = rows.filter((row) => row.id === id);
  if (!matching.length) throw new Error(`No participant with ID ${id}`);
  return matching;
}
