import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPROVERS,
  BIOMES,
  ROOT,
  STAGES,
  commandContext,
  isApproved,
  readArtifact,
} from "./guard.mjs";

const BASELINE_LINEUP = ["nearest", "nearest", "nearest", "nearest"];
const OPPONENTS = ["nearest", "nearest", "nearest"];
const PROFILES = {
  baseline: { seed: "baseline", matches: 4 },
  bench: { seed: "dev", matches: 4 },
  holdout: { seed: "holdout", matches: 8 },
};
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

function botPaths(context) {
  const candidates = [`bots/${context.bot}.ts`, `bots/${context.bot}`];

  return candidates.filter((path) => existsSync(resolve(context.root, path)));
}

function botTests(context) {
  const folder = resolve(context.root, "bots", context.bot);
  if (!existsSync(folder)) return [];

  return readdirSync(folder, { recursive: true })
    .map((file) => String(file).split("\\").join("/"))
    .filter((file) => /\.(test|spec)\.ts$/.test(file) && !file.startsWith("_workflow/"))
    .map((file) => `bots/${context.bot}/${file}`);
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
  const header = ["bot".padEnd(16), ...runs.map((run) => run.biome.slice(0, 6).padStart(7))];
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
    report(context, [id.padEnd(16), ...cells, ...totals].join(""));
  }
}

function compare(context, profile) {
  const lineup = profile === "baseline" ? BASELINE_LINEUP : [context.bot, ...OPPONENTS];
  const biomes = context.biome ? [context.biome] : BIOMES;
  const { seed, matches } = PROFILES[profile];
  const perBiome = context.biome ? matches * 2 : matches;
  report(
    context,
    `${profile}: ${lineup.join(", ")} | ${perBiome} matches per map type | seed ${seed}`,
  );
  report(context, "Mean banked score per map type (higher is better):");
  const request = { profile, lineup, matches: perBiome };
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
  const lineup = [context.bot, ...OPPONENTS].join(",");
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

function runTests(context) {
  const files = botTests(context);
  if (!files.length) {
    report(context, `FAIL  no tests found under bots/${context.bot}/ (*.test.ts)`);

    return false;
  }

  return step(context, {
    name: `bot tests (${files.length} files)`,
    args: ["--import", "tsx", "--test", ...files],
  });
}

function checkDiscovery(context) {
  const result = execute(context, ["--import", "tsx", "src/cli.ts", "bots"]);
  const listed = result.stdout.split("\n").some((line) => line.startsWith(`${context.bot} `));
  report(context, `${listed ? "PASS" : "FAIL"}  ${context.bot} is discovered by the game`);
  if (!listed) report(context, result.stderr.trim());

  return listed;
}

function runChecks(context) {
  const paths = botPaths(context);
  const results = [
    checkDiscovery(context),
    step(context, { name: "types", args: [TOOLS.typescript, "--noEmit"] }),
    step(context, { name: "structure rules", args: ["scripts/check-structure.mjs"] }),
    step(context, { name: "formatting", args: [TOOLS.prettier, "--check", ...paths] }),
    runTests(context),
  ];

  return results.every(Boolean) ? 0 : 1;
}

function formatBot(context) {
  return step(context, {
    name: "format bot files",
    args: [TOOLS.prettier, "--write", ...botPaths(context)],
  })
    ? 0
    : 1;
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

const OPERATIONS = {
  status: printStatus,
  baseline: (context) => compare(context, "baseline"),
  bench: (context) => compare(context, "bench"),
  holdout: (context) => compare(context, "holdout"),
  play: playMatch,
  test: (context) => (runTests(context) ? 0 : 1),
  check: runChecks,
  format: formatBot,
};

function saveEvidence(context, exitCode) {
  if (context.operation === "status") return;
  const suffix = context.biome ? `-${context.biome}` : "";
  const name = `${context.stage}-${context.operation}${suffix}.txt`;
  const folder = resolve(context.root, context.folder, "evidence");
  const command = `node .github/bot-workflow/run.mjs ${context.stage} ${context.bot} ${context.operation}${context.biome ? ` ${context.biome}` : ""}`;
  mkdirSync(folder, { recursive: true });
  const body = [`$ ${command}`, `exit code: ${exitCode}`, "", ...context.log].join("\n");
  writeFileSync(resolve(folder, name), `${body}\n`);
  process.stdout.write(`Evidence saved: ${context.folder}/evidence/${name}\n`);
}

export function run(context) {
  const exitCode = OPERATIONS[context.operation](context);
  saveEvidence(context, exitCode);

  return exitCode;
}

function main() {
  try {
    const [stage, bot, operation, biome] = process.argv.slice(2);
    const command = ["node .github/bot-workflow/run.mjs", stage, bot, operation, biome]
      .filter(Boolean)
      .join(" ");
    const context = commandContext(command, { root: ROOT, stage });
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
