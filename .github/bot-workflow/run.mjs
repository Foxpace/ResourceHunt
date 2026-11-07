import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPROVERS,
  BIOMES,
  ROOT,
  SLUG,
  STAGES,
  checkInputs,
  isApproved,
  readArtifact,
} from "./guard.mjs";
import { listFiles, writeZip } from "./zip.mjs";

const EVERY_STAGE = Object.keys(STAGES);
export const OPERATIONS = {
  status: EVERY_STAGE,
  baseline: EVERY_STAGE,
  bench: ["plan", "build"],
  play: ["plan", "build", "review"],
  check: ["build", "review"],
  format: ["build", "review"],
  holdout: ["build"],
  tournament: ["review"],
  pack: ["review"],
};
const UNGATED = new Set(["status", "baseline"]);
const BOT_ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const MAX_LINEUP = 15;
const OPPONENTS = ["nearest", "nearest", "nearest"];
const TOURNAMENT_SEEDS = ["handin-1", "handin-2", "handin-3"];
const PROFILES = {
  baseline: { seed: "baseline", rounds: 1 },
  bench: { seed: "dev", rounds: 1 },
  holdout: { seed: "holdout", rounds: 2 },
};
const USAGE =
  "Usage: node .github/bot-workflow/run.mjs <stage> <bot-id> <operation> [biome] [--vs id,id,...]";
const TOOLS = {
  typescript: "node_modules/typescript/bin/tsc",
  prettier: "node_modules/prettier/bin/prettier.cjs",
};

function execute(context, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: context.root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 180_000,
  });
  const failure = result.error ? `${result.error.message}\n` : "";

  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr + failure,
  };
}

function report(context, line = "") {
  context.log.push(line);
  process.stdout.write(`${line}\n`);
}

/** The team's bot files: the final bot, its local practice bots, and its folder. */
function familyPaths(context) {
  const ownsFile = (name) =>
    name === `${context.bot}.ts` || (name.startsWith(`${context.bot}-`) && name.endsWith(".ts"));
  const names = readdirSync(resolve(context.root, "bots"));

  return names
    .filter((name) => ownsFile(name) || name === context.bot)
    .map((name) => `bots/${name}`);
}

function benchmark(context, request) {
  const { profile, biome, lineup, matches } = request;
  const args = ["--import", "tsx", "src/cli.ts", "bench", "--bots", lineup.join(",")];
  const seed = `${PROFILES[profile].seed}-${biome}`;
  args.push("--matches", String(matches), "--seed", seed, "--biome", biome, "--json");
  const result = execute(context, args);
  try {
    const standings = groupReplicas(JSON.parse(result.stdout).standings);

    return { biome, standings, status: result.status };
  } catch {
    report(context, `${biome}: benchmark failed (exit ${result.status})`);
    report(context, result.stderr.trim().split("\n").slice(-5).join("\n"));

    return { biome, standings: [], status: result.status };
  }
}

/** Merge replica rows such as nearest-copy-1..3 into one averaged row per strategy. */
function groupReplicas(standings) {
  const groups = new Map();
  for (const row of standings) {
    const id = row.id.replace(/-copy-\d+$/, "");
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }

  return [...groups].map(([id, rows]) => ({
    id,
    meanScore: rows.reduce((sum, row) => sum + row.meanScore, 0) / rows.length,
    wins: rows.reduce((sum, row) => sum + row.wins, 0),
    errors: rows.reduce((sum, row) => sum + row.errors, 0),
  }));
}

function scoreTable(context, runs) {
  const ids = [...new Set(runs.flatMap((run) => run.standings.map((row) => row.id)))];
  const width = Math.max(16, ...ids.map((id) => id.length + 2));
  const header = ["bot".padEnd(width), ...runs.map((run) => run.biome.slice(0, 6).padStart(7))];
  report(context, [...header, "   mean", " wins", " errors"].join(""));
  for (const id of ids) {
    const rows = runs.map((run) => run.standings.find((row) => row.id === id));
    const scores = rows.map((row) => row?.meanScore ?? 0);
    const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
    const wins = rows.reduce((sum, row) => sum + (row?.wins ?? 0), 0);
    const errors = rows.reduce((sum, row) => sum + (row?.errors ?? 0), 0);
    const cells = scores.map((score) => score.toFixed(0).padStart(7));
    const totals = [
      mean.toFixed(1).padStart(7),
      String(wins).padStart(5),
      String(errors).padStart(7),
    ];
    report(context, [id.padEnd(width), ...cells, ...totals].join(""));
  }
}

function compare(context, profile) {
  const lineup =
    profile === "baseline" ? ["nearest", ...OPPONENTS] : [context.bot, ...context.opponents];
  const biomes = context.biome ? [context.biome] : BIOMES;
  const { seed, rounds } = PROFILES[profile];
  const matches = lineup.length * rounds * (context.biome ? 2 : 1);
  report(
    context,
    `${profile}: ${lineup.join(", ")} | ${matches} matches per map type | seed ${seed}`,
  );
  report(context, "Mean banked score per map type (higher is better):");
  const request = { profile, lineup, matches };
  const runs = biomes.map((biome) => benchmark(context, { ...request, biome }));
  scoreTable(context, runs);

  const crashed = runs.some((run) => !run.standings.length);
  const ownErrors = runs.some((run) => run.standings.some(isOwnBotError(context)));
  if (ownErrors) report(context, `${context.bot} had errors or timeouts. See the errors column.`);

  return crashed || ownErrors ? 1 : 0;
}

function isOwnBotError(context) {
  return (row) => row.id === context.bot && row.errors > 0;
}

function playMatch(context) {
  const biome = context.biome ?? "riverlands";
  const replay = `results/${context.bot}-${biome}.replay.json`;
  mkdirSync(resolve(context.root, "results"), { recursive: true });
  const lineup = [context.bot, ...context.opponents].join(",");
  const args = ["--import", "tsx", "src/cli.ts", "play", "--bots", lineup, "--biome", biome];
  args.push("--seed", `dev-play-${biome}`, "--stats", "none", "--replay", replay);
  const result = execute(context, args);
  report(context, result.stdout.trim());
  if (result.status !== 0) report(context, result.stderr.trim());
  report(context, `Replay: ${replay}. Watch it with \`yarn dev\` -> Import.`);

  return result.status;
}

function step(context, request) {
  const result = execute(context, request.args);
  const passed = result.status === 0;
  report(context, `${passed ? "PASS" : "FAIL"}  ${request.name}`);
  if (!passed)
    report(context, `${result.stdout}${result.stderr}`.trim().split("\n").slice(-30).join("\n"));

  return passed;
}

function checkDiscovery(context) {
  const result = execute(context, ["--import", "tsx", "src/cli.ts", "bots"]);
  const lines = result.stdout.split("\n");
  const listed = lines.some((line) => line.startsWith(`${context.bot} `));
  const local = lines
    .filter((line) => line.startsWith(`${context.bot}-`))
    .map((line) => line.split(" ")[0]);
  const skipped = result.stderr
    .split("\n")
    .filter((line) => line.startsWith(`Bot skipped: ${context.bot}`));
  const passed = listed && !skipped.length;
  const extra = local.length ? ` (local bots: ${local.join(", ")})` : "";
  report(context, `${passed ? "PASS" : "FAIL"}  ${context.bot} is discovered by the game${extra}`);
  if (!passed) report(context, (skipped.join("\n") || result.stderr).trim());

  return passed;
}

function runChecks(context) {
  const paths = familyPaths(context);
  const results = [
    checkDiscovery(context),
    step(context, { name: "types", args: [TOOLS.typescript, "--noEmit"] }),
    step(context, { name: "structure rules", args: ["scripts/check-structure.mjs"] }),
    step(context, { name: "formatting", args: [TOOLS.prettier, "--check", ...paths] }),
  ];

  return results.every(Boolean) ? 0 : 1;
}

function formatBot(context) {
  return step(context, {
    name: "format bot files",
    args: [TOOLS.prettier, "--write", ...familyPaths(context)],
  })
    ? 0
    : 1;
}

function practiceBotIds(context) {
  const prefix = `bots/${context.bot}-`;

  return familyPaths(context)
    .filter((path) => path.startsWith(prefix) && path.endsWith(".ts"))
    .map((path) => path.slice("bots/".length, -".ts".length));
}

/** The dress rehearsal: the team bot, its practice bots, and two copies of `nearest`. */
function tournamentLineup(context) {
  const opponents = context.customOpponents
    ? context.opponents
    : [...practiceBotIds(context), "nearest", "nearest"];

  return [context.bot, ...opponents].slice(0, MAX_LINEUP);
}

function playTournament(context, request) {
  const { lineup, seed } = request;
  const args = ["--import", "tsx", "src/cli.ts", "tournament", "--bots", lineup.join(",")];
  args.push("--wins", "3", "--seed", seed, "--json");
  const result = execute(context, args);
  try {
    const standings = JSON.parse(result.stdout).standings;
    const place = standings.findIndex((row) => row.id === context.bot) + 1;
    if (place === 0) throw new Error(`${context.bot} is missing from the standings.`);

    return { seed, standings, place, team: standings[place - 1] };
  } catch {
    report(context, `${seed}: tournament failed (exit ${result.status})`);
    report(context, result.stderr.trim().split("\n").slice(-5).join("\n"));

    return null;
  }
}

function summarizeTournaments(context, results) {
  const played = results.filter(Boolean);
  const won = played.filter((result) => result.place === 1).length;
  const places = played.reduce((sum, result) => sum + result.place, 0);
  const errors = played.reduce((sum, result) => sum + result.team.errors, 0);
  const meanPlace = (places / Math.max(1, played.length)).toFixed(1);
  const size = played[0]?.standings.length ?? 0;
  report(context, "");
  report(
    context,
    `Summary: won ${won} of ${results.length}, average place ${meanPlace} of ${size}, ${errors} errors.`,
  );

  return played.length < results.length || errors > 0 ? 1 : 0;
}

function tournaments(context) {
  const lineup = tournamentLineup(context);
  report(
    context,
    `tournament x${TOURNAMENT_SEEDS.length}: ${lineup.join(", ")} | first to 3 round wins`,
  );
  const results = TOURNAMENT_SEEDS.map((seed) => playTournament(context, { lineup, seed }));
  for (const result of results.filter(Boolean)) {
    const { seed, standings, place, team } = result;
    const line = `${seed}: place ${place} of ${standings.length}, ${team.wins} round wins, score ${team.score}`;
    report(context, `${line}, ${team.errors} errors. Winner: ${standings[0].id}`);
  }

  return summarizeTournaments(context, results);
}

/** Removes practice bots, checks the final bot, and zips it with its workflow folder. */
function packHandIn(context) {
  const review = readArtifact({ root: context.root, folder: context.folder, name: "REVIEW.md" });
  if (!review || !isApproved(review)) {
    report(
      context,
      "REVIEW.md is not approved yet. Ask the risk owner first. Nothing was removed.",
    );
    return 1;
  }
  for (const id of practiceBotIds(context)) {
    rmSync(resolve(context.root, `bots/${id}.ts`));
    report(context, `Removed practice bot bots/${id}.ts`);
  }
  if (runChecks(context) !== 0) return 1;

  const target = `results/${context.bot}-handin.zip`;
  const files = listFiles(context.root, familyPaths(context));
  mkdirSync(resolve(context.root, "results"), { recursive: true });
  writeZip(context.root, { files, target });
  report(
    context,
    `Packed ${files.length} files into ${target}. Send this file to the facilitator.`,
  );

  return 0;
}

function printStatus(context) {
  for (const stage of Object.keys(STAGES)) {
    const name = STAGES[stage].artifact;
    const content = readArtifact({ root: context.root, folder: context.folder, name });
    const reviewed = content !== null && isApproved(content);
    const state = content === null ? "missing" : reviewed ? "approved" : "draft";
    report(context, `${name.padEnd(13)} ${state.padEnd(9)} approver: ${APPROVERS[name]}`);
  }

  return 0;
}

const OPERATIONS_RUN = {
  status: printStatus,
  baseline: (context) => compare(context, "baseline"),
  bench: (context) => compare(context, "bench"),
  holdout: (context) => compare(context, "holdout"),
  play: playMatch,
  check: runChecks,
  format: formatBot,
  tournament: tournaments,
  pack: packHandIn,
};

function saveEvidence(context, exitCode) {
  if (context.operation === "status") return;
  const biome = context.biome ? `-${context.biome}` : "";
  const versus = context.customOpponents ? `-vs-${context.opponents.join("_")}` : "";
  const name = `${context.stage}-${context.operation}${biome}${versus}`.slice(0, 120) + ".txt";
  const folder = resolve(context.root, context.folder, "evidence");
  const body = [`$ ${context.command}`, `exit code: ${exitCode}`, "", ...context.log].join("\n");
  mkdirSync(folder, { recursive: true });
  writeFileSync(resolve(folder, name), `${body}\n`);
  process.stdout.write(`Evidence saved: ${context.folder}/evidence/${name}\n`);
}

export function availableOperations(stage) {
  return Object.keys(OPERATIONS).filter((operation) => OPERATIONS[operation].includes(stage));
}

function parseOptions(rest) {
  const at = rest.indexOf("--vs");
  const customOpponents = at >= 0;
  const listed = customOpponents ? String(rest[at + 1] ?? "").split(",") : OPPONENTS;
  const opponents = listed.filter(Boolean);
  const positional = rest.filter((_, index) => !customOpponents || index < at || index > at + 1);
  const [biome, extra] = positional;
  if (extra !== undefined || (biome !== undefined && !BIOMES.includes(biome)))
    throw new Error(`${USAGE}\nBiomes: ${BIOMES.join(", ")}.`);
  const validIds = opponents.length > 0 && opponents.every((id) => BOT_ID.test(id));
  if (!validIds || opponents.length >= MAX_LINEUP)
    throw new Error(`--vs takes 1 to ${MAX_LINEUP - 1} comma-separated bot IDs.`);

  return { biome, opponents, customOpponents };
}

export function parseRequest(args, root = ROOT) {
  const [stage, bot, operation, ...rest] = args;
  const known = Boolean(STAGES[stage] && OPERATIONS[operation]) && SLUG.test(bot ?? "");
  if (!known) throw new Error(USAGE);
  if (!OPERATIONS[operation].includes(stage))
    throw new Error(`Available in ${stage}: ${availableOperations(stage).join(", ")}.`);

  const folder = `bots/${bot}/_workflow`;
  if (!UNGATED.has(operation)) checkInputs({ root, stage, folder });
  const command = ["node .github/bot-workflow/run.mjs", ...args].join(" ");

  return { root, stage, bot, operation, folder, command, ...parseOptions(rest) };
}

export function run(context) {
  const exitCode = OPERATIONS_RUN[context.operation](context);
  saveEvidence(context, exitCode);

  return exitCode;
}

function main() {
  try {
    const context = parseRequest(process.argv.slice(2));
    process.exitCode = run({ ...context, log: [] });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1]
  ? resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) main();
