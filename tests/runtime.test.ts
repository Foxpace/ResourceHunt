import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after as afterAll, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGame, runToEnd } from "../src/runtime/matches.ts";
import { normalizeConfig } from "../src/engine/config.ts";
import { discoverBots, getDefaultBotIds } from "../src/runtime/bots.ts";
import { startServer } from "../src/server.ts";
import { runBenchmark } from "../src/runtime/benchmark.ts";
import { parseArguments, configFromFlags } from "../src/cli/options.ts";

const directories: string[] = [];

test("default lineup includes competitive play and follows UI discovery order", () => {
  const ids = ["custom", "nearest", "rover", "strategist"];
  const catalog = {
    bots: ids.map((id) => ({ id, name: id, description: "Test", file: `${id}.ts` })),
    errors: [],
  };
  assert.deepStrictEqual(getDefaultBotIds(catalog), ids);
});

test("CLI argument parsing preserves inputs and supports help and config flags", () => {
  const args = ["play", "--ticks", "42", "--seed", "cleanup", "--json"];
  const parsed = parseArguments(args);
  assert.strictEqual(args[0], "play");
  assert.partialDeepStrictEqual(configFromFlags(parsed.flags), { ticks: 42, seed: "cleanup" });
  assert.strictEqual(parseArguments(["--help"]).flags.has("help"), true);
  assert.throws(() => parseArguments(["play", "--matches", "2"]));
});

test("reusable benchmarks rotate base slots and keep the same seed for each rotation", async () => {
  const bots = (await discoverBots()).bots.slice(0, 2);
  const progress: number[] = [];
  const result = await runBenchmark(
    bots,
    normalizeConfig({ seed: "rotation", ticks: 2 }),
    3,
    (completed) => progress.push(completed),
  );
  assert.deepStrictEqual(
    result.results.map((match) => match.botOrder),
    [
      bots.map((bot) => bot.id),
      [...bots].reverse().map((bot) => bot.id),
      bots.map((bot) => bot.id),
    ],
  );
  assert.deepStrictEqual(
    result.results.map((match) => match.config.seed),
    ["rotation:0", "rotation:0", "rotation:1"],
  );
  assert.strictEqual(
    result.standings.every((bot) => Number.isFinite(bot.meanScore) && bot.errors === 0),
    true,
  );
  assert.deepStrictEqual(progress, [1, 2, 3]);
});
afterAll(async () => {
  for (const directory of directories) await rm(directory, { recursive: true, force: true });
});
async function fixture(files: Record<string, string>) {
  const directory = await mkdtemp(join(tmpdir(), "resource-hunt-test-"));
  directories.push(directory);
  for (const [file, code] of Object.entries(files)) await writeFile(join(directory, file), code);
  return directory;
}

test("discovers bot classes without registration and reports broken files", async () => {
  const directory = await fixture({
    "new-bot.ts":
      'export default class { static metadata = {id:"new-bot",name:"New bot",description:"Discovered"}; act(state) { return {type:"skip"}; } }',
    "broken.ts": "export default class {}",
    "_helper.ts": 'throw new Error("should not import");',
  });
  const catalog = await discoverBots(directory);
  assert.deepStrictEqual(
    catalog.bots.map((bot) => bot.id),
    ["new-bot"],
  );
  assert.strictEqual(catalog.errors.length, 1);
  const game = await createGame(catalog.bots, normalizeConfig({ ticks: 2 }), false);
  try {
    await runToEnd(game);
    assert.strictEqual(game.result().standings[0]!.errors, 0);
  } finally {
    game.dispose();
  }
});

test(
  "sample bots reproduce identical full-match results in workers",
  { timeout: 15000 },
  async () => {
    const catalog = await discoverBots();
    assert.deepStrictEqual(catalog.errors, []);
    assert.ok(catalog.bots.length >= 5);
    assert.ok(catalog.bots.some((bot) => bot.id === "strategist"));
    const run = async () => {
      const game = await createGame(
        catalog.bots,
        normalizeConfig({ seed: "integration", ticks: 60 }),
        false,
      );
      try {
        await runToEnd(game);
        return game.result();
      } finally {
        game.dispose();
      }
    };
    const first = await run();
    assert.deepStrictEqual(first, await run());
    assert.strictEqual(
      first.standings.every((bot) => bot.errors === 0 && bot.score > 0),
      true,
    );
  },
);

test("hung bot loses a turn and is disabled without hanging the match", async () => {
  const directory = await fixture({
    "hung.ts":
      'export default class { static metadata = {id:"hung",name:"Hung",description:"Test"}; act() { while(true) {} } }',
  });
  const catalog = await discoverBots(directory);
  const game = await createGame(
    catalog.bots,
    normalizeConfig({ ticks: 3, decisionTimeoutMs: 20 }),
    false,
  );
  try {
    await runToEnd(game);
    assert.partialDeepStrictEqual(game.result().standings[0], { errors: 1, disabled: true });
    assert.strictEqual(game.result().ticks, 3);
  } finally {
    game.dispose();
  }
});

test("CLI emits parseable JSON and proper exit codes", async () => {
  const run = promisify(execFile);
  const { stdout, stderr } = await run(process.execPath, [
    "--import",
    "tsx",
    "src/cli.ts",
    "play",
    "--ticks",
    "8",
    "--seed",
    "cli",
    "--json",
  ]);
  assert.strictEqual(stderr, "");
  assert.strictEqual(JSON.parse(stdout).ticks, 8);
  await assert.rejects(
    run(process.execPath, ["--import", "tsx", "src/cli.ts", "play", "--ticks", "0", "--json"]),
    { code: 1 },
  );
});

test("HTTP UI uses the same engine results as the CLI runner", { timeout: 15000 }, async () => {
  const app = await startServer(0);
  const origin = `http://127.0.0.1:${app.port}`;
  try {
    const page = await fetch(origin);
    assert.strictEqual(page.status, 200);
    assert.ok((await page.text()).includes("Resource hunt"));
    const script = await fetch(`${origin}/assets/app.js`);
    assert.strictEqual(script.status, 200);
    assert.ok(script.headers.get("content-type")?.includes("text/javascript"));
    assert.ok((await script.text()).length > 1000);
    const stylesheet = await fetch(`${origin}/assets/style.css`);
    assert.strictEqual(stylesheet.status, 200);
    assert.ok(stylesheet.headers.get("content-type")?.includes("text/css"));
    const catalog = (await (await fetch(`${origin}/api/bots`)).json()) as any;
    const botIds = catalog.bots.slice(0, 2).map((bot: any) => bot.id);
    const config = normalizeConfig({ ticks: 5, seed: "http-parity" });
    const response = await fetch(`${origin}/api/games`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config, botIds }),
    });
    assert.strictEqual(response.status, 201);
    const session = (await response.json()) as any;
    let result: unknown;
    for (let i = 0; i < 5; i++) {
      const step = (await (
        await fetch(`${origin}/api/games/${session.id}/step`, { method: "POST" })
      ).json()) as any;
      assert.strictEqual(step.snapshot.tick, i + 1);
      result = step.result;
    }
    const descriptors = (await discoverBots()).bots.filter((bot) => botIds.includes(bot.id));
    const headless = await createGame(descriptors, config, false);
    try {
      await runToEnd(headless);
      assert.deepStrictEqual(result, headless.result());
    } finally {
      headless.dispose();
    }
    const replay = (await (await fetch(`${origin}/api/games/${session.id}/replay`)).json()) as any;
    assert.strictEqual(replay.frames.length, 5);
    const crossOrigin = await fetch(`${origin}/api/games`, {
      method: "POST",
      headers: { Origin: "https://example.com", "Content-Type": "application/json" },
      body: "{}",
    });
    assert.strictEqual(crossOrigin.status, 403);
  } finally {
    await app.dispose();
  }
});
