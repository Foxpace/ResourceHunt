import { isMainModule } from "./runtime/entrypoint.ts";
import { HELP, parseArguments, configFromFlags } from "./cli/options.ts";
import { runBenchmark } from "./runtime/benchmark.ts";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { MatchResult } from "./engine/types.ts";
import { discoverBots, selectBots, getDefaultBotIds } from "./runtime/bots.ts";
import { createGame, runToEnd } from "./runtime/matches.ts";

export async function main(args = process.argv.slice(2)): Promise<number> {
  const { command, flags } = parseArguments(args);
  if (flags.has("help")) {
    console.log(HELP);
    return 0;
  }
  const catalog = await discoverBots();
  for (const error of catalog.errors) console.error(`Bot skipped: ${error.file}: ${error.error}`);
  if (command === "bots") {
    console.log(
      flags.has("json")
        ? JSON.stringify(catalog, null, 2)
        : catalog.bots
            .map((bot) => `${bot.id.padEnd(16)} ${bot.name.padEnd(16)} ${bot.description}`)
            .join("\n"),
    );
    return catalog.errors.length ? 2 : 0;
  }
  const ids = flags.get("bots")?.split(",") ?? getDefaultBotIds(catalog);
  const bots = selectBots(catalog, ids);
  const config = configFromFlags(flags);
  let payload: unknown;
  let hasErrors = catalog.errors.length > 0;
  if (command === "play") {
    const game = await createGame(bots, config, flags.has("replay"));
    try {
      await runToEnd(game);
      payload = game.result();
      hasErrors ||= game.result().standings.some((bot) => bot.errors > 0);
      if (flags.has("replay")) await writeJson(flags.get("replay")!, game.replay());
      if (!flags.has("json")) printResult(game.result());
    } finally {
      game.dispose();
    }
  } else {
    const matches = Number(flags.get("matches") ?? 20);
    const benchmark = await runBenchmark(
      bots,
      config,
      matches,
      flags.has("json")
        ? undefined
        : (completed) => {
            process.stderr.write(`\rBenchmark ${completed}/${matches}`);
          },
    );
    hasErrors ||= benchmark.standings.some((bot) => bot.errors > 0);
    payload = benchmark;
    if (!flags.has("json")) {
      console.error("");
      console.table(benchmark.standings);
    }
  }
  if (flags.has("json")) console.log(JSON.stringify(payload, null, 2));
  if (flags.has("output")) await writeJson(flags.get("output")!, payload);
  return hasErrors ? 2 : 0;
}

async function writeJson(path: string, data: unknown) {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await writeFile(absolute, JSON.stringify(data, null, 2) + "\n");
}
function printResult(result: MatchResult) {
  console.log(`\nResource hunt · seed ${result.config.seed} · ${result.ticks} ticks\n`);
  console.table(result.standings);
}
if (isMainModule(import.meta.url)) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
