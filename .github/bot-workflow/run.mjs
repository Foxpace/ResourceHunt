import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findPrettier, PRETTIER_CONFIG_ARGS, PRETTIER_SKIPPED } from "../../scripts/format.mjs";
import {
  APPROVERS,
  BIOMES,
  ROOT,
  SLUG,
  STAGES,
  checkInputs,
  isApproved,
  readArtifact,
  teamOf,
} from "./guard.mjs";
import {
  describeTournament,
  mean,
  participantStrategies,
  sum,
  summarizePerformance,
  summarizeTournamentRuns,
} from "./performance.mjs";
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
const TOURNAMENT_WIN_TARGET = 3;
const PROFILES = {
  baseline: { seed: "baseline", rounds: 1 },
  bench: { seed: "dev", rounds: 1 },
  holdout: { seed: "holdout", rounds: 2 },
};
const BIOME_DETAIL_COLUMNS = [
  "biome",
  "maps",
  "matches",
  "avg rank",
  "wins",
  "ties",
  "range",
  "margin",
  "captures",
  "stolen",
  "lost",
  "unbanked",
  "errors",
];
const USAGE =
  "Usage: node .github/bot-workflow/run.mjs <stage> <bot-id> <operation> [biome] [--vs id,id,...] [--label name]";
const TOOLS = {
  typescript: "node_modules/typescript/bin/tsc",
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
    stderr: (result.stderr ?? "") + failure,
  };
}

function report(context, line = "") {
  context.log.push(line);
  process.stdout.write(`${line}\n`);
}

/** The team's bot files: the final bot, its local practice bots, and its folder. */
function familyPaths(context) {
  const handIn = handInPaths(context);
  const entries = readdirSync(resolve(context.root, "bots"), { withFileTypes: true });

  return entries.flatMap((entry) => {
    const path = `bots/${entry.name}`;
    if (handIn.includes(path)) return [path];

    const hasPrefix = entry.name.startsWith(`${context.bot}-`);
    const isSource = entry.isFile() && entry.name.endsWith(".ts");
    if (!hasPrefix || !isSource) return [];

    return teamOf(context.root, path) === context.bot ? [path] : [];
  });
}

function handInPaths(context) {
  return [`bots/${context.bot}.ts`, `bots/${context.bot}`];
}

function benchmark(context, request) {
  const { profile, biome, lineup, matches } = request;
  const seed = `${PROFILES[profile].seed}-${biome}`;
  const result = execute(context, benchmarkArgs({ ...request, seed }));
  const diagnostics = result.stderr.trim();
  const { status } = result;
  const run = { biome, seed, status, diagnostics };
  if (diagnostics) report(context, diagnostics.split("\n").slice(-5).join("\n"));
  try {
    if (![0, 2].includes(status)) throw new Error(`CLI exited with status ${status}`);
    const data = JSON.parse(result.stdout);
    if (data.results.length !== matches) throw new Error("incomplete match results");
    const participants = participantStrategies(data.results[0].botOrder, lineup);
    const standings = [...new Set(lineup)].map((id) =>
      summarizePerformance(data.results, { id, participants }),
    );

    return { ...run, participants, standings, data };
  } catch (error) {
    report(context, `${biome}: benchmark failed (${error.message})`);

    return { ...run, standings: [], data: null, failure: error.message };
  }
}

function benchmarkArgs({ lineup, matches, seed, biome }) {
  const args = ["--import", "tsx", "src/cli.ts", "bench", "--bots", lineup.join(",")];
  args.push("--matches", String(matches), "--seed", seed, "--biome", biome);

  return [...args, "--score-history", "--json"];
}

function printTable(context, headings, rows) {
  const cells = [headings, ...rows].map((row) => row.map(String));
  const widths = headings.map((_, index) => Math.max(...cells.map((row) => row[index].length)));
  for (const row of cells) {
    const aligned = row.map((cell, index) =>
      index === 0 ? cell.padEnd(widths[index]) : cell.padStart(widths[index]),
    );
    report(context, aligned.join("  "));
  }
}

function scoreTable(context, runs) {
  const ids = [...new Set(runs.flatMap((run) => run.standings.map((row) => row.id)))];
  const headings = ["bot", ...runs.map((run) => run.biome), "mean", "wins", "ties", "errors"];
  const rows = ids.map((id) => strategyScoreRow(id, runs));
  const meanColumn = headings.indexOf("mean");
  rows.sort((first, second) => Number(second[meanColumn]) - Number(first[meanColumn]));
  report(context, "Mean banked score by biome. Wins are outright wins. Ties are shared firsts.");
  printTable(context, headings, rows);
}

function strategyScoreRow(id, runs) {
  const byBiome = runs.map((run) => run.standings.find((row) => row.id === id));
  const completed = byBiome.filter(Boolean);

  return [
    id,
    ...byBiome.map((row) => row?.meanScore.toFixed(1) ?? "-"),
    mean(completed.map((row) => row.meanScore)).toFixed(1),
    sum(completed, "wins"),
    sum(completed, "ties"),
    sum(completed, "errors"),
  ];
}

function biomeDetailRow(run, id) {
  const row = run.standings.find((standing) => standing.id === id);
  const maps = new Set(run.data.results.map((match) => match.config.seed)).size;

  return [
    run.biome,
    maps,
    run.data.matches,
    row.meanRank.toFixed(1),
    row.wins,
    row.ties,
    `${row.minScore}..${row.maxScore}`,
    row.meanMargin?.toFixed(1) ?? "-",
    row.captures,
    row.stolen,
    row.lost,
    row.meanUnbanked.toFixed(1),
    row.errors,
  ];
}

function reportBenchmarkDetails(context, runs, id) {
  const completed = runs.filter((run) => run.data);
  const matches = completed.reduce((total, run) => total + run.data.matches, 0);
  report(context, `Completed ${completed.length}/${runs.length} biomes, ${matches} matches.`);
  if (!completed.length) return;

  scoreTable(context, runs);
  report(context);
  report(context, `${id} by biome. Margin is mean score versus the top rival in each match.`);
  report(context, "Unbanked is mean cargo value at the end. Captures, stolen and lost are totals.");
  printTable(
    context,
    BIOME_DETAIL_COLUMNS,
    completed.map((run) => biomeDetailRow(run, id)),
  );
}

function writeBenchmarkEvidence(context, evidence) {
  const { lineup, runs } = evidence;
  const completed = runs.filter((run) => run.data);
  const results = completed.flatMap((run) => run.data.results);
  const participants = completed[0]?.participants;
  const summary = participants
    ? [...new Set(lineup)].map((id) => summarizePerformance(results, { id, participants }))
    : [];
  if (summary.length) printOptimizationTable(context, summary);

  const data = { label: context.label, ...evidence, summary };
  const path = writeEvidence(context, "json", JSON.stringify(data, null, 2));
  report(context, `Match data: ${path}`);
}

function printOptimizationTable(context, summary) {
  const rows = summary.map((row) => [
    row.id,
    row.meanFirstBankTick?.toFixed(1) ?? "-",
    row.meanHalfwayScore?.toFixed(1) ?? "-",
    row.pointsPerDeposit?.toFixed(1) ?? "-",
    row.pointsPerTile?.toFixed(2) ?? "-",
    row.scorelessStarts,
    row.disabledStarts,
  ]);
  report(context);
  report(
    context,
    "Banking and movement across completed matches. First bank averages scoring starts.",
  );
  printTable(
    context,
    [
      "bot",
      "first bank tick",
      "halfway pts",
      "pts/deposit",
      "pts/tile",
      "scoreless starts",
      "disabled starts",
    ],
    rows,
  );
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
  const request = { profile, lineup, matches };
  const runs = biomes.map((biome) => benchmark(context, { ...request, biome }));
  reportBenchmarkDetails(context, runs, lineup[0]);
  writeBenchmarkEvidence(context, { profile, lineup, runs });

  const crashed = runs.some((run) => !run.data);
  const ownErrors = runs.some((run) => run.standings.some(isOwnBotError(lineup[0])));
  if (ownErrors) report(context, `${lineup[0]} had errors or timeouts. See the errors column.`);

  return crashed || ownErrors ? 1 : 0;
}

function isOwnBotError(id) {
  return (row) => row.id === id && row.errors > 0;
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
  if (result.stderr) report(context, result.stderr.trim());
  if (result.status === 0) report(context, "Watch the replay with `yarn dev` -> Import.");

  return result.status;
}

function step(context, request) {
  const result = execute(context, request.args);
  const passed = result.status === 0;
  const label = request.advisory ? "WARN" : "FAIL";
  report(context, `${passed ? "PASS" : label}  ${request.name}`);
  if (!passed)
    report(context, `${result.stdout}${result.stderr}`.trim().split("\n").slice(-30).join("\n"));

  return passed;
}

/** @param {string[]} paths */
function checkDiscovery(context, paths) {
  const result = execute(context, ["--import", "tsx", "src/cli.ts", "bots"]);
  const ids = result.stdout.split("\n").map((line) => line.split(" ")[0]);
  const listed = ids.includes(context.bot);
  const local = ids.filter((id) => {
    const isPracticeId = id.startsWith(`${context.bot}-`);
    const hasPracticeFile = paths.includes(`bots/${id}.ts`);

    return isPracticeId && hasPracticeFile;
  });
  const skipped = result.stderr.split("\n").filter((line) => skippedBotInPaths(line, paths));
  const passed = listed && !skipped.length;
  const extra = local.length ? ` (local bots: ${local.join(", ")})` : "";
  report(context, `${passed ? "PASS" : "FAIL"}  ${context.bot} is discovered by the game${extra}`);
  if (!passed) report(context, (skipped.join("\n") || result.stderr).trim());

  return passed;
}

function skippedBotInPaths(line, paths) {
  const file = line.match(/^Bot skipped: (.+?): /)?.[1];
  if (!file) return false;

  return paths.some((path) => {
    const exactFile = `bots/${file}` === path;
    const withinFolder = `bots/${file}`.startsWith(`${path}/`);

    return exactFile || withinFolder;
  });
}

function runChecks(context, paths = familyPaths(context)) {
  const results = [
    checkDiscovery(context, paths),
    step(context, { name: "types", args: [TOOLS.typescript, "--noEmit"] }),
    step(context, { name: "structure rules", args: ["scripts/check-structure.mjs"] }),
  ];
  formatBotFiles(context, "--check", paths);

  return results.every(Boolean) ? 0 : 1;
}

function formatBotFiles(context, mode, paths = familyPaths(context)) {
  const prettier = findPrettier(context.root);
  if (!prettier) {
    report(context, PRETTIER_SKIPPED);

    return true;
  }

  const advisory = mode === "--check";
  return step(context, {
    name: advisory ? "formatting (optional)" : "format bot files",
    args: [prettier, ...PRETTIER_CONFIG_ARGS, mode, ...paths],
    advisory,
  });
}

function formatBot(context) {
  return formatBotFiles(context, "--write") ? 0 : 1;
}

function practiceBotIds(context) {
  const prefix = `bots/${context.bot}-`;

  return familyPaths(context)
    .filter((path) => {
      const belongsToTeam = path.startsWith(prefix);
      const isTypeScript = path.endsWith(".ts");
      return belongsToTeam && isTypeScript;
    })
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
  args.push("--wins", String(TOURNAMENT_WIN_TARGET), "--seed", seed, "--json");
  if (context.biome) args.push("--biome", context.biome);
  const result = execute(context, args);
  const { status } = result;
  const diagnostics = result.stderr.trim();
  const run = { seed, status, diagnostics };
  if (diagnostics) report(context, diagnostics.split("\n").slice(-5).join("\n"));
  try {
    if (![0, 2].includes(status)) throw new Error(`CLI exited with status ${status}`);
    const data = JSON.parse(result.stdout);

    return { ...run, ...describeTournament(data, lineup), data };
  } catch (error) {
    report(context, `${seed}: tournament failed (${error.message})`);

    return { ...run, data: null, failure: error.message };
  }
}

function reportTournament(context, run) {
  const { seed, standings, team, winnerIds, progression } = run;
  report(context, "");
  report(
    context,
    `${seed} finished after ${progression.length} rounds. Winners: ${winnerIds.join(", ")}.`,
  );
  const finish = standings.map((row) => [row.id, row.place, row.score, row.wins, row.errors]);
  printTable(context, ["bot", "place", "points", "round wins", "errors"], finish);
  report(context, `${team.id} by round. Tied leaders each earn a round win.`);
  const rounds = progression.map((round) => tournamentRoundRow(round, team.id));
  printTable(
    context,
    ["round", "biome", "points", "total pts", "rank", "total wins", "leaders"],
    rounds,
  );
}

function tournamentRoundRow(round, id) {
  const row = round.standings.find((standing) => standing.id === id);

  return [
    round.round,
    round.biome,
    row.score,
    row.cumulativeScore,
    row.rank,
    row.cumulativeWins,
    round.leaders.join(", "),
  ];
}

function tournaments(context) {
  const lineup = tournamentLineup(context);
  report(
    context,
    `tournament x${TOURNAMENT_SEEDS.length}: ${lineup.join(", ")} | first to ${TOURNAMENT_WIN_TARGET} round wins`,
  );
  const runs = TOURNAMENT_SEEDS.map((seed) => playTournament(context, { lineup, seed }));
  for (const run of runs.filter((run) => run.data)) reportTournament(context, run);

  const summary = summarizeTournamentRuns(runs);
  reportTournamentSummary(context, summary);
  const evidence = {
    label: context.label,
    lineup,
    winTarget: TOURNAMENT_WIN_TARGET,
    summary,
    runs,
  };
  const path = writeEvidence(context, "json", JSON.stringify(evidence, null, 2));
  report(context, `Tournament data: ${path}`);

  const incomplete = summary.completed < summary.attempted;
  const teamErrors = summary.errors > 0;

  return incomplete || teamErrors ? 1 : 0;
}

function reportTournamentSummary(context, summary) {
  const {
    wins,
    sharedWins,
    attempted,
    completed,
    rounds,
    roundWins,
    sharedRoundWins,
    meanRoundScore,
    meanPlace,
    errors,
  } = summary;
  report(context, "");
  report(
    context,
    `Won ${wins} of ${completed} completed tournaments (${sharedWins} shared). Completed ${completed}/${attempted}.`,
  );
  if (!completed) return;
  report(
    context,
    `${roundWins} wins in ${rounds} rounds (${sharedRoundWins} shared), ${meanRoundScore.toFixed(1)} points per round, average place ${meanPlace.toFixed(1)}, ${errors} errors.`,
  );
}

/** Check the final bot and zip it with its team folder. */
function packHandIn(context) {
  const review = readArtifact({ root: context.root, folder: context.folder, name: "REVIEW.md" });
  const reviewApproved = review !== null && isApproved(review);
  if (!reviewApproved) {
    report(context, "REVIEW.md is not approved yet. Ask the risk owner first.");
    return 1;
  }
  const paths = handInPaths(context);
  if (runChecks(context, paths) !== 0) return 1;

  const target = `results/${context.bot}-handin.zip`;
  const files = listFiles(context.root, paths);
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

function writeEvidence(context, extension, body) {
  const biome = context.biome ? `-${context.biome}` : "";
  const versus = context.customOpponents ? `-vs-${context.opponents.join("_")}` : "";
  const label = context.label ? `.label-${context.label}` : "";
  const stem = evidenceStem(`${context.stage}-${context.operation}${biome}${versus}`, label);
  const folder = `${context.folder}/evidence`;
  const path = `${folder}/${stem}.${extension}`;
  mkdirSync(resolve(context.root, folder), { recursive: true });
  writeFileSync(resolve(context.root, path), `${body}\n`);

  return path;
}

function evidenceStem(name, label) {
  if (name.length + label.length <= 120) return name + label;
  const hash = createHash("sha256")
    .update(name + label)
    .digest("hex")
    .slice(0, 12);

  return `${name.slice(0, 107 - label.length)}-${hash}${label}`;
}

function saveEvidence(context, exitCode) {
  if (context.operation === "status") return;
  const body = [`$ ${context.command}`, `exit code: ${exitCode}`, "", ...context.log].join("\n");
  const path = writeEvidence(context, "txt", body);
  process.stdout.write(`Evidence saved: ${path}\n`);
}

export function availableOperations(stage) {
  return Object.keys(OPERATIONS).filter((operation) => OPERATIONS[operation].includes(stage));
}

function parseOptions(rest) {
  const options = { opponents: OPPONENTS, customOpponents: false };
  for (let index = 0; index < rest.length; index++) {
    const arg = rest[index];
    const newLineup = arg === "--vs" && !options.customOpponents;
    const newLabel = arg === "--label" && !options.label;
    const newBiome = !options.biome && BIOMES.includes(arg);
    if (newLineup) {
      options.opponents = parseOpponents(rest[++index]);
      options.customOpponents = true;
    } else if (newLabel) {
      options.label = parseEvidenceLabel(rest[++index]);
    } else if (newBiome) {
      options.biome = arg;
    } else {
      throw new Error(`${USAGE}\nBiomes: ${BIOMES.join(", ")}.`);
    }
  }

  return options;
}

function parseOpponents(value = "") {
  const opponents = value.split(",").filter(Boolean);
  const validIds = opponents.length > 0 && opponents.every((id) => BOT_ID.test(id));
  const withinLimit = opponents.length < MAX_LINEUP;
  if (!validIds || !withinLimit)
    throw new Error(`--vs takes 1 to ${MAX_LINEUP - 1} comma-separated bot IDs.`);

  return opponents;
}

function parseEvidenceLabel(value = "") {
  if (!BOT_ID.test(value))
    throw new Error("--label takes 1 to 48 lowercase letters, digits, or hyphens.");

  return value;
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
