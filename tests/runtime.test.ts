import { test } from "node:test";
import assert from "node:assert/strict";
import { request, type RequestOptions } from "node:http";
import { normalizeConfig } from "../src/engine/config.ts";
import {
  createControllers,
  discoverBots,
  getDefaultBotIds,
  selectBots,
} from "../src/runtime/bots.ts";
import { runBenchmark } from "../src/runtime/benchmark.ts";
import { parseArguments, configFromFlags } from "../src/cli/options.ts";
import { createObservation } from "./helpers/sdk-fixtures.ts";
import {
  assertBenchmarkRotation,
  createBotDirectory,
  createHttpMatch,
  createHttpServer,
  DISCOVERY_FILES,
  HUNG_BOT_FILES,
  TERRAIN_EDIT_BOT_FILES,
  WEATHER_TERRAIN_BOT_FILES,
  downloadHttpReplay,
  finishHttpMatch,
  runCli,
  runWorkerMatch,
} from "./helpers/runtime-fixtures.ts";

test("the default lineup follows discovery order", () => {
  // Given
  const ids = ["custom", "nearest", "harbor", "comet"];
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
  const bots = selectBots(await discoverBots(), ["nearest", "nearest"]);
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

test("benchmarks can average sandbox decision latency by action", async (context) => {
  // Given
  const directory = await createBotDirectory(context, DISCOVERY_FILES);
  const { bots } = await discoverBots(directory);
  const config = normalizeConfig({ ticks: 3 });

  // When
  const result = await runBenchmark(bots, config, { matches: 2, actionTiming: true });
  const { byAction, id, ...timing } = result.actionTiming![0]!;

  // Then
  assert.equal(timing.actions, 6);
  assert.ok(timing.totalMs > 0);
  assert.equal(timing.meanMsPerAction, timing.totalMs / 6);
  assert.equal(timing.meanMsPerTick, timing.meanMsPerAction);
  assert.equal(id, "new-bot");
  assert.deepEqual(byAction, [{ action: "skip", ...timing }]);
});

test("CLI benchmarks omit decision timing by default", async () => {
  // Given
  const args = ["bench", "--bots", "nearest", "--matches", "1", "--ticks", "2", "--json"];

  // When
  const { stdout } = await runCli(args);

  // Then
  assert.equal(Object.hasOwn(JSON.parse(stdout), "actionTiming"), false);
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

test("the sample catalog contains the nearest baseline", async () => {
  // Given
  const discover = discoverBots;

  // When
  const catalog = await discover();

  // Then
  assert.deepEqual(catalog.errors, []);
  assert.ok(catalog.bots.some((bot) => bot.id === "nearest"));
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

test("worker turns receive independent terrain even when its revision stays the same", async (context) => {
  // Given
  const directory = await createBotDirectory(context, TERRAIN_EDIT_BOT_FILES);
  const { bots } = await discoverBots(directory);

  // When
  const result = await runWorkerMatch(bots, { ticks: 3, naturalEvents: false });

  // Then
  assert.equal(result.standings[0]!.errors, 0);
});

test(
  "a worker rejects an overlapping decision and completes the first",
  { timeout: 3000 },
  async (context) => {
    // Given
    const lineup = selectBots(await discoverBots(), ["nearest"]);
    const [worker] = await createControllers(lineup, normalizeConfig());
    context.after(() => worker!.dispose());
    const observation = createObservation();

    // When
    const first = worker!.decide(observation);
    const second = await worker!.decide(observation);

    // Then
    assert.match(second.error ?? "", /request in progress/);
    assert.deepEqual(await first, { action: { type: "skip" } });
  },
);

test("worker terrain follows a hazard from forecast through expiry", async (context) => {
  // Given
  const directory = await createBotDirectory(context, WEATHER_TERRAIN_BOT_FILES);
  const { bots } = await discoverBots(directory);

  // When
  const result = await runWorkerMatch(bots, { ticks: 26, biome: "volcanic", seed: "tick-volcano" });

  // Then
  assert.equal(result.standings[0]!.errors, 0);
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

test("the HTTP server rejects game creation with a forged Host and matching Origin", async (context) => {
  // Given
  const http = await createHttpServer(context);
  const host = `rebind.example:${new URL(http.origin).port}`;
  const headers = { Host: host, Origin: `http://${host}` };
  const options = { path: "/api/games", method: "POST", headers };
  const body = JSON.stringify({ config: normalizeConfig({ ticks: 1 }), botIds: ["nearest"] });

  // When
  const status = await requestStatus(http.origin, options, body);

  // Then
  assert.equal(status, 403);
});

test("the HTTP server rejects asset requests with a forged Host and no Origin", async (context) => {
  // Given
  const http = await createHttpServer(context);
  const headers = { Host: `rebind.example:${new URL(http.origin).port}` };

  // When
  const status = await requestStatus(http.origin, { path: "/", headers });

  // Then
  assert.equal(status, 403);
});

test("an absolute request target cannot override the validated Host", async (context) => {
  // Given
  const http = await createHttpServer(context);
  const origin = `http://rebind.example:${new URL(http.origin).port}`;
  const options = { path: `${origin}/api/bots`, headers: { Origin: origin } };

  // When
  const status = await requestStatus(http.origin, options);

  // Then
  assert.equal(status, 400);
});

test("the HTTP server rejects duplicate Host headers", async (context) => {
  // Given
  const http = await createHttpServer(context);
  const headers = ["Host", new URL(http.origin).host, "Host", "rebind.example"];

  // When
  const status = await requestStatus(http.origin, { path: "/", headers });

  // Then
  assert.equal(status, 403);
});

for (const hostname of ["localhost", "127.0.0.1"]) {
  test(`same-origin requests on ${hostname} reach match validation`, async (context) => {
    // Given
    const http = await createHttpServer(context);
    const origin = new URL(http.origin);
    origin.hostname = hostname;

    // When
    const response = await fetch(new URL("/api/games", origin), {
      method: "POST",
      headers: { Origin: origin.origin },
      body: "{}",
    });

    // Then
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "Game configuration is required" });
  });
}

function requestStatus(origin: string, options: RequestOptions, body?: string) {
  return new Promise<number | undefined>((resolve, reject) => {
    const outgoing = request(origin, options, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    outgoing.on("error", reject);
    outgoing.end(body);
  });
}
