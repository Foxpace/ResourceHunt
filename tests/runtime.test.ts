import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig } from "../src/engine/config.ts";
import { discoverBots, getDefaultBotIds } from "../src/runtime/bots.ts";
import { runBenchmark } from "../src/runtime/benchmark.ts";
import { parseArguments, configFromFlags } from "../src/cli/options.ts";
import {
  assertBenchmarkRotation,
  createBotDirectory,
  createHttpMatch,
  createHttpServer,
  DISCOVERY_FILES,
  HUNG_BOT_FILES,
  downloadHttpReplay,
  finishHttpMatch,
  runCli,
  runWorkerMatch,
} from "./helpers/runtime-fixtures.ts";

test("the default lineup follows discovery order and includes competitive bots", () => {
  // Given
  const ids = ["custom", "nearest", "rover", "strategist"];
  const catalog = {
    bots: ids.map((id) => ({ id, name: id, description: "Test", file: `${id}.ts` })),
    errors: [],
  };

  // When
  const selectedIds = getDefaultBotIds(catalog);

  // Then
  assert.deepEqual(selectedIds, ids);
});

test("CLI parsing preserves its input and reads configuration flags", () => {
  // Given
  const argumentsList = ["play", "--ticks", "42", "--seed", "cleanup", "--json"];
  const original = [...argumentsList];

  // When
  const parsed = parseArguments(argumentsList);

  // Then
  assert.deepEqual(argumentsList, original);
  assert.partialDeepStrictEqual(configFromFlags(parsed.flags), { ticks: 42, seed: "cleanup" });
});

test("CLI parsing recognizes help", () => {
  // Given
  const argumentsList = ["--help"];

  // When
  const parsed = parseArguments(argumentsList);

  // Then
  assert.equal(parsed.flags.has("help"), true);
});

test("CLI parsing rejects benchmark-only flags on the play command", () => {
  // Given
  const argumentsList = ["play", "--matches", "2"];

  // When
  const parse = () => parseArguments(argumentsList);

  // Then
  assert.throws(parse);
});

test("benchmarks rotate base slots, reuse seeds, and publish progress", async () => {
  // Given
  const bots = (await discoverBots()).bots.slice(0, 2);
  const botIds = bots.map((bot) => bot.id);
  const progress: number[] = [];

  // When
  const result = await runBenchmark(bots, normalizeConfig({ seed: "rotation", ticks: 2 }), {
    matches: 3,
    onProgress: (completed) => progress.push(completed),
  });

  // Then
  assertBenchmarkRotation(result, { botIds, progress });
  assert.ok(result.standings.every((bot) => Number.isFinite(bot.meanScore)));
  assert.ok(result.standings.every((bot) => bot.errors === 0));
  assertBenchmarkStatistics(result);
});

function assertBenchmarkStatistics(result: Awaited<ReturnType<typeof runBenchmark>>) {
  for (const bot of result.standings) {
    const rows = result.results.map((match) => match.standings.find((row) => row.id === bot.id)!);
    const gathered = rows.reduce((sum, row) => sum + row.statistics!.gathered, 0);
    assert.equal(bot.statistics.gathered, gathered);
  }
}

test("discovery finds bot classes, reports broken files, and skips private helpers", async (context) => {
  // Given
  const directory = await createBotDirectory(context, DISCOVERY_FILES);

  // When
  const catalog = await discoverBots(directory);

  // Then
  assert.deepEqual(
    catalog.bots.map((bot) => bot.id),
    ["new-bot"],
  );
  assert.equal(catalog.errors.length, 1);
});

test("a newly discovered bot runs without registration", async (context) => {
  // Given
  const directory = await createBotDirectory(context, DISCOVERY_FILES);
  const catalog = await discoverBots(directory);

  // When
  const result = await runWorkerMatch(catalog.bots, { ticks: 2 });

  // Then
  assert.equal(result.standings[0]!.errors, 0);
});

test("the sample catalog contains valid strategies including the strategist", async () => {
  // Given
  const discover = discoverBots;

  // When
  const catalog = await discover();

  // Then
  assert.deepEqual(catalog.errors, []);
  assert.ok(catalog.bots.length >= 5);
  assert.ok(catalog.bots.some((bot) => bot.id === "strategist"));
});

test("sample bots reproduce identical full matches in workers", { timeout: 15000 }, async () => {
  // Given
  const { bots } = await discoverBots();
  const config = { seed: "integration", ticks: 60 };

  // When
  const first = await runWorkerMatch(bots, config);
  const repeated = await runWorkerMatch(bots, config);

  // Then
  assert.deepEqual(first, repeated);
  assert.ok(first.standings.every((bot) => bot.errors === 0));
  assert.ok(first.standings.every((bot) => bot.score > 0));
});

test("a hung bot is disabled after one error without hanging the match", async (context) => {
  // Given
  const directory = await createBotDirectory(context, HUNG_BOT_FILES);
  const { bots } = await discoverBots(directory);

  // When
  const result = await runWorkerMatch(bots, { ticks: 3, decisionTimeoutMs: 20 });

  // Then
  assert.partialDeepStrictEqual(result.standings[0], { errors: 1, disabled: true });
  assert.equal(result.ticks, 3);
});

test("the CLI emits parseable match JSON without stderr output", async () => {
  // Given
  const argumentsList = ["play", "--ticks", "8", "--seed", "cli", "--json"];

  // When
  const { stdout, stderr } = await runCli(argumentsList);

  // Then
  assert.equal(stderr, "");
  assert.equal(JSON.parse(stdout).ticks, 8);
});

test("the CLI exits with code one for invalid configuration", async () => {
  // Given
  const argumentsList = ["play", "--ticks", "0", "--json"];

  // When
  const execution = runCli(argumentsList);

  // Then
  await assert.rejects(execution, { code: 1 });
});

for (const asset of [
  { path: "/", contentType: "text/html", text: "<title>Resource Hunt</title>", minimumLength: 0 },
  { path: "/assets/app.js", contentType: "text/javascript", text: "", minimumLength: 1000 },
  { path: "/assets/style.css", contentType: "text/css", text: "", minimumLength: 0 },
]) {
  test(`the HTTP server serves ${asset.path}`, async (context) => {
    // Given
    const http = await createHttpServer(context);

    // When
    const response = await http.fetch(asset.path);
    const body = await response.text();

    // Then
    assert.equal(response.status, 200);
    assert.ok(response.headers.get("content-type")?.includes(asset.contentType));
    assert.ok(body.includes(asset.text));
    assert.ok(body.length > asset.minimumLength);
  });
}

test(
  "HTTP matches produce the same results as the headless runner",
  { timeout: 15000 },
  async (context) => {
    // Given
    const fixture = await createHttpMatch(context);

    // When
    const httpMatch = await finishHttpMatch(fixture);
    const headless = await runWorkerMatch(fixture.bots, fixture.config);

    // Then
    assert.equal(fixture.response.status, 201);
    assert.deepEqual(httpMatch.ticks, [1, 2, 3, 4, 5]);
    assert.deepEqual(httpMatch.result, headless);
  },
);

test("HTTP replay downloads include every completed turn", async (context) => {
  // Given
  const fixture = await createHttpMatch(context);
  await finishHttpMatch(fixture);

  // When
  const replay = await downloadHttpReplay(fixture);

  // Then
  assert.equal(replay.frames.length, 5);
});

test("the HTTP server rejects cross-origin game creation", async (context) => {
  // Given
  const http = await createHttpServer(context);
  const headers = { Origin: "https://example.com", "Content-Type": "application/json" };

  // When
  const response = await http.fetch("/api/games", { method: "POST", headers, body: "{}" });

  // Then
  assert.equal(response.status, 403);
});
