import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { MAX_SEED_LENGTH, normalizeConfig } from "../src/engine/config.ts";
import { parseReplay } from "../src/engine/replay.ts";
import { createGameApi } from "../src/http/game-api.ts";
import type { BenchmarkResult } from "../src/runtime/benchmark.ts";
import { HttpGameClient } from "../src/web/data/game-client.ts";
import { Playback } from "../src/web/model/playback.ts";
import {
  createCliReplay,
  createHttpServer,
  createRuntimeTestDirectory,
  runCli,
} from "./helpers/runtime-fixtures.ts";

test("format check ignores executable configuration in a bot folder", async (context) => {
  // Given
  const directory = await createFormatFixture(context);
  const script = fileURLToPath(new URL("../scripts/format.mjs", import.meta.url));

  // When
  await promisify(execFile)(process.execPath, [script, "--check", "bots/bot.ts"], {
    cwd: directory,
  });

  // Then
  await assert.rejects(access(`${directory}/marker`), { code: "ENOENT" });
});

async function createFormatFixture(context: TestContext): Promise<string> {
  const directory = await createRuntimeTestDirectory(context);
  const modules = fileURLToPath(new URL("../node_modules", import.meta.url));
  await symlink(modules, `${directory}/node_modules`, "junction");
  await mkdir(`${directory}/bots`);
  await writeFile(`${directory}/bots/bot.ts`, "const value = 1;\n");
  await writeFile(
    `${directory}/bots/.prettierrc.cjs`,
    'require("node:fs").writeFileSync("marker", "ran"); module.exports = {};',
  );

  return directory;
}

test("play rejects identical result and replay paths before writing either file", async (context) => {
  // Given
  const directory = await createRuntimeTestDirectory(context);
  const args = [
    "play",
    "--output",
    `${directory}/./match.json`,
    "--replay",
    `${directory}/match.json`,
  ];

  // When
  const execution = runCli(args);

  // Then
  await assert.rejects(execution, { code: 1, stdout: "", stderr: /must use different paths/ });
});

test("play saves results at the first unused numbered path", async (context) => {
  // Given
  const directory = await createRuntimeTestDirectory(context);
  const path = `${directory}/match.json`;
  const first = `${directory}/match-1.json`;
  const second = `${directory}/match-2.json`;
  await writeFile(path, "existing file");
  await writeFile(first, "earlier results");

  // When
  const args = ["play", "--bots", "nearest", "--ticks", "1", "--json", "--output", path];
  const { stdout, stderr } = await runCli(args);

  // Then
  assert.equal(await readFile(path, "utf8"), "existing file");
  assert.equal(await readFile(first, "utf8"), "earlier results");
  assert.deepEqual(JSON.parse(await readFile(second, "utf8")), JSON.parse(stdout));
  assert.equal(stderr.trim(), `Saved results to ${second}`);
});

test("play saves a numbered replay when the requested path is a symlink", async (context) => {
  // Given
  const directory = await createRuntimeTestDirectory(context);
  const target = `${directory}/unrelated.txt`;
  const path = `${directory}/replay.json`;
  await writeFile(target, "existing file");
  await symlink(target, path);

  // When
  await runCli(["play", "--bots", "nearest", "--ticks", "1", "--json", "--replay", path]);

  // Then
  assert.equal(await readFile(path, "utf8"), "existing file");
  const numbered = await readFile(`${directory}/replay-1.json`, "utf8");
  assert.equal(parseReplay(JSON.parse(numbered)).frames.length, 1);
});

test("inspect preserves its input when given the same output path", async (context) => {
  // Given
  const directory = await createRuntimeTestDirectory(context);
  const path = `${directory}/report.json`;
  const report = JSON.stringify({ winners: [], rounds: [], standings: [] });
  await writeFile(path, report);

  // When
  const { stdout } = await runCli(["inspect", "--input", path, "--output", path, "--json"]);

  // Then
  assert.equal(await readFile(path, "utf8"), report);
  const numbered = await readFile(`${directory}/report-1.json`, "utf8");
  assert.deepEqual(JSON.parse(numbered), JSON.parse(stdout));
});

test("CLI statistic selection prints only the requested counter", async () => {
  // Given
  const args = ["play", "--bots", "nearest", "--ticks", "1", "--stats", "gathered"];

  // When
  const { stdout } = await runCli(args);

  // Then
  assert.match(stdout, /\bgathered\b/);
  assert.doesNotMatch(stdout, /\btilesWalked\b/);
});

test("CLI can suppress the statistics table", async () => {
  // Given
  const args = ["play", "--bots", "nearest", "--ticks", "1", "--stats", "none"];

  // When
  const { stdout } = await runCli(args);

  // Then
  assert.doesNotMatch(stdout, /\bgathered\b/);
});

test("bench accepts a maximum-length seed and rotates maps in groups", async () => {
  // Given
  const seed = "x".repeat(MAX_SEED_LENGTH);
  const args = ["bench", "--matches", "3", "--ticks", "1", "--bots", "nearest,nearest"];

  // When
  const { stdout } = await runCli([...args, "--seed", seed, "--json"]);
  const { results } = JSON.parse(stdout) as BenchmarkResult;

  // Then
  assert.equal(results[0]!.config.seed, results[1]!.config.seed);
  assert.notEqual(results[1]!.config.seed, results[2]!.config.seed);
});

test("benchmark score history follows the rotated starting order", async () => {
  // Given
  const args = ["bench", "--matches", "2", "--ticks", "60", "--bots", "nearest,nearest"];

  // When
  const { stdout } = await runCli([...args, "--score-history", "--json"]);
  const { results } = JSON.parse(stdout) as BenchmarkResult;

  // Then
  for (const { scores, botOrder, standings, ticks } of results) {
    assert.equal(scores?.length, ticks + 1);
    assert.deepEqual(scores[0], [0, 0]);
    const final = botOrder.map((id) => standings.find((row) => row.id === id)!.score);
    assert.deepEqual(scores.at(-1), final);
  }
});

test("concurrent UI match requests respect the open-match limit", async (context) => {
  // Given
  const api = createGameApi();
  context.after(() => api.dispose());
  const opening = Array.from({ length: 12 }, () => api.fetch(matchRequest(null)));

  // When
  const overflow = await api.fetch(matchRequest(null));
  await Promise.all(opening);

  // Then
  assert.equal(overflow.status, 429);
});

test("failed UI match requests release their pending slots", async (context) => {
  // Given
  const api = createGameApi();
  context.after(() => api.dispose());
  await Promise.all(Array.from({ length: 12 }, () => api.fetch(matchRequest(null))));

  // When
  const response = await api.fetch(
    matchRequest({ config: normalizeConfig({ ticks: 1 }), botIds: ["nearest"] }),
  );

  // Then
  assert.equal(response.status, 201);
});

test("UI match creation stops if the server closes during the request", async () => {
  // Given
  const api = createGameApi();
  const request = matchRequest({ config: normalizeConfig({ ticks: 1 }), botIds: ["nearest"] });

  // When
  const creation = api.fetch(request);
  api.dispose();

  // Then
  assert.equal((await creation).status, 503);
});

test("the UI rejects a match beyond its replay size budget", async (context) => {
  // Given
  const api = createGameApi();
  context.after(() => api.dispose());
  const config = normalizeConfig({ width: 81, height: 81, ticks: 1000 });

  // When
  const response = await api.fetch(matchRequest({ config, botIds: ["nearest"] }));

  // Then
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Use the headless CLI/);
});

test("a CLI replay matches the UI across hazard start and expiry", async (context) => {
  // Given
  const { playback, replay } = await playVolcanicMatch(context);
  const ticks = [0, 17, 18, 24, 25, 26];
  const live = await snapshotsAt(playback, ticks);

  // When
  await playback.load(replay);
  const imported = await snapshotsAt(playback, ticks);

  // Then
  assert.deepEqual(imported, live);
});

async function playVolcanicMatch(context: TestContext) {
  const http = await createHttpServer(context);
  const playback = new Playback(new HttpGameClient(http.origin));
  context.after(() => playback.dispose());
  const replay = await createCliReplay(context, [
    "--biome",
    "volcanic",
    "--seed",
    "tick-volcano",
    "--ticks",
    "26",
  ]);

  await playback.create({ config: replay.initial.config, botIds: ["nearest"] });
  while (playback.canStep) await playback.step();

  return { playback, replay };
}

function matchRequest(body: unknown): Request {
  return new Request("http://localhost/api/games", { method: "POST", body: JSON.stringify(body) });
}

async function snapshotsAt(playback: Playback, ticks: number[]) {
  const snapshots = [];
  for (const tick of ticks) {
    await playback.seek(tick);
    snapshots.push(playback.snapshot);
  }
  return snapshots;
}
