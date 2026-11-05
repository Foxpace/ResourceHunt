import { isMainModule } from "./runtime/entrypoint.ts";
import { HELP, parseArguments, configFromFlags } from "./cli/options.ts";
import { runBenchmark } from "./runtime/benchmark.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { selectAwards } from "./competition/awards.ts";
import { inspectResults } from "./cli/inspect.ts";
import {
  badgeOptionsFromFlags,
  printBadges,
  printStandings,
  validateStatisticFlags,
} from "./cli/results.ts";
import { runCliTournament } from "./cli/tournament.ts";
import type { GameConfig } from "./engine/types.ts";
import {
  type BotDescriptor,
  type BotCatalog,
  discoverBots,
  selectBots,
  getDefaultBotIds,
} from "./runtime/bots.ts";
import { createGame, runToEnd } from "./runtime/matches.ts";

export async function main(args = process.argv.slice(2)): Promise<number> {
  const { command, flags } = parseArguments(args);
  if (flags.has("help")) {
    console.log(HELP);
    return 0;
  }

  validateStatisticFlags(flags);
  if (command === "inspect") {
    await writeCommandOutput(await inspectResults(flags), flags);
    return 0;
  }

  return runBotCommand(command, flags);
}

async function runBotCommand(command: string, flags: ReadonlyMap<string, string>): Promise<number> {
  const catalog = await discoverBots();

  for (const error of catalog.errors) console.error(`Bot skipped: ${error.file}: ${error.error}`);

  if (command === "bots") {
    printBotCatalog(catalog, flags.has("json"));
    return catalog.errors.length ? 2 : 0;
  }

  const ids = flags.get("bots")?.split(",") ?? getDefaultBotIds(catalog);
  const bots = selectBots(catalog, ids);
  const config = configFromFlags(flags);
  const { payload, hasBotErrors } =
    command === "play"
      ? await playMatch(bots, config, flags)
      : command === "tournament"
        ? await runCliTournament(bots, config, flags)
        : await benchmarkMatches(bots, config, flags);

  const hasErrors = catalog.errors.length > 0 || hasBotErrors;
  await writeCommandOutput(payload, flags);

  return hasErrors ? 2 : 0;
}

async function writeJson(path: string, data: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(data, null, 2) + "\n");
}
if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

async function playMatch(
  bots: BotDescriptor[],
  config: GameConfig,
  flags: ReadonlyMap<string, string>,
) {
  const game = await createGame(bots, config, flags.has("replay"));
  try {
    await runToEnd(game);
    const result = game.result();
    const badges = selectAwards(result.standings, config.seed, badgeOptionsFromFlags(flags));
    const payload = { ...result, badges };
    const hasBotErrors = payload.standings.some((bot) => bot.errors > 0);
    if (flags.has("replay")) await writeJson(flags.get("replay")!, game.replay());
    if (!flags.has("json")) {
      console.log(`Resource Hunt · seed ${config.seed} · ${result.ticks} ticks`);
      printStandings(result.standings, flags);
      printBadges(badges);
    }

    return { payload, hasBotErrors };
  } finally {
    game.dispose();
  }
}

async function benchmarkMatches(
  bots: BotDescriptor[],
  config: GameConfig,
  flags: ReadonlyMap<string, string>,
) {
  const matches = Number(flags.get("matches") ?? 20);
  const benchmark = await runBenchmark(bots, config, {
    matches: matches,
    onProgress: flags.has("json")
      ? undefined
      : (completed) => {
          process.stderr.write(`\rBenchmark ${completed}/${matches}`);
        },
  });
  const hasBotErrors = benchmark.standings.some((bot) => bot.errors > 0);
  if (!flags.has("json")) {
    console.error("");
    printStandings(benchmark.standings, flags);
  }

  return { payload: benchmark, hasBotErrors };
}

function printBotCatalog(catalog: BotCatalog, json: boolean) {
  console.log(
    json
      ? JSON.stringify(catalog, null, 2)
      : catalog.bots
          .map((bot) => `${bot.id.padEnd(16)} ${bot.name.padEnd(16)} ${bot.description}`)
          .join("\n"),
  );
}

async function writeCommandOutput(
  payload: unknown,
  flags: ReadonlyMap<string, string>,
): Promise<void> {
  if (flags.has("json")) console.log(JSON.stringify(payload, null, 2));
  if (flags.has("output")) await writeJson(flags.get("output")!, payload);
}
