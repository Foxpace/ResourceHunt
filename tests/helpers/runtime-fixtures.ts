import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { TestContext } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGame, runToEnd } from "../../src/runtime/matches.ts";
import { discoverBots, type BotDescriptor } from "../../src/runtime/bots.ts";
import { normalizeConfig } from "../../src/engine/config.ts";
import { startServer } from "../../src/server.ts";
import type { GameConfig, Replay } from "../../src/engine/types.ts";
import { parseReplay } from "../../src/engine/replay.ts";
import type {
  BotCatalogResponse,
  CreateGameResponse,
  StepGameResponse,
} from "../../src/http/types.ts";

export const DISCOVERY_FILES = {
  "new-bot.ts":
    'export default class { static metadata = {id:"new-bot",name:"New bot",description:"Discovered"}; act() { return {type:"skip"}; } }',
  "broken.ts": "export default class {}",
  "_helper.ts": 'throw new Error("should not import");',
};
export const HUNG_BOT_FILES = {
  "hung.ts":
    'export default class { static metadata = {id:"hung",name:"Hung",description:"Test"}; act() { while(true) {} } }',
};
export const TERRAIN_EDIT_BOT_FILES = {
  "terrain-edit.ts": `
    export default class {
      static metadata = { id: "terrain-edit", name: "Terrain edit", description: "Test" };
      act(state) {
        if (state.map.tiles[0][0] === "edited") throw new Error("Saw a previous turn's map edit");
        state.map.tiles[0][0] = "edited";
        return { type: "skip" };
      }
    }
  `,
};
export const WEATHER_TERRAIN_BOT_FILES = {
  "weather-terrain.ts": `
    export default class {
      static metadata = { id: "weather-terrain", name: "Weather terrain", description: "Test" };
      act(state) {
        this.hazard ??= state.world.hazards[0];
        const { center: { x, y }, startsAt, endsAt } = this.hazard;
        const actual = state.map.tiles[y][x];
        this.initial ??= actual;
        const active = state.tick >= startsAt && state.tick < endsAt;
        if (actual !== (active ? "lava" : this.initial)) throw new Error("Stale terrain");
        return { type: "skip" };
      }
    }
  `,
};

export async function createRuntimeTestDirectory(context: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "resource-hunt-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export async function createBotDirectory(
  context: TestContext,
  files: Record<string, string>,
): Promise<string> {
  const directory = await createRuntimeTestDirectory(context);
  for (const [file, code] of Object.entries(files)) await writeFile(join(directory, file), code);

  return directory;
}

export async function runWorkerMatch(bots: BotDescriptor[], config: Partial<GameConfig>) {
  const game = await createGame(bots, normalizeConfig(config), false);
  try {
    await runToEnd(game);

    return game.result();
  } finally {
    game.dispose();
  }
}

export function runCli(argumentsList: string[]) {
  return promisify(execFile)(process.execPath, ["--import", "tsx", "src/cli.ts", ...argumentsList]);
}

export async function createCliReplay(context: TestContext, args: string[]): Promise<Replay> {
  const directory = await createRuntimeTestDirectory(context);
  const path = join(directory, "replay.json");
  await runCli(["play", "--bots", "nearest", "--json", "--replay", path, ...args]);

  return parseReplay(JSON.parse(await readFile(path, "utf8")));
}

export async function createHttpServer(context: TestContext) {
  const app = await startServer(0);
  context.after(() => app.dispose());
  const origin = `http://127.0.0.1:${app.port}`;

  return {
    origin,
    fetch: (path: string, options?: RequestInit) => fetch(`${origin}${path}`, options),
  };
}

export async function createHttpMatch(
  context: TestContext,
  options: { botIds?: string[]; config?: Partial<GameConfig> } = {},
) {
  const http = await createHttpServer(context);
  const catalog = (await (await http.fetch("/api/bots")).json()) as BotCatalogResponse;
  const botIds = options.botIds ?? catalog.bots.slice(0, 2).map((bot) => bot.id);
  const config = normalizeConfig({ ticks: 5, seed: "http-parity", ...options.config });
  const response = await http.fetch("/api/games", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ config, botIds }),
  });
  const session = (await response.json()) as CreateGameResponse;
  const descriptors = (await discoverBots()).bots;
  const bots = botIds.map((id) => descriptors.find((bot) => bot.id === id)!);

  return { http, config, response, session, bots };
}

export async function finishHttpMatch(fixture: Awaited<ReturnType<typeof createHttpMatch>>) {
  const ticks: number[] = [];
  let finalStep!: StepGameResponse;
  for (let turn = 0; turn < 5; turn++) {
    const response = await fixture.http.fetch(`/api/games/${fixture.session.id}/step`, {
      method: "POST",
    });
    finalStep = (await response.json()) as StepGameResponse;
    ticks.push(finalStep.snapshot.tick);
  }

  return { ticks, result: finalStep.result };
}

export async function downloadHttpReplay(
  fixture: Awaited<ReturnType<typeof createHttpMatch>>,
): Promise<Replay> {
  const response = await fixture.http.fetch(`/api/games/${fixture.session.id}/replay`);

  return response.json() as Promise<Replay>;
}

export function assertBenchmarkRotation(
  result: Awaited<ReturnType<typeof import("../../src/runtime/benchmark.ts").runBenchmark>>,
  expected: { botIds: string[]; progress: number[] },
): void {
  assert.deepEqual(
    result.results.map((match) => match.botOrder),
    [expected.botIds, [...expected.botIds].reverse(), expected.botIds],
  );
  assert.deepEqual(
    result.results.map((match) => match.config.seed),
    ["rotation:0", "rotation:0", "rotation:1"],
  );
  assert.deepEqual(expected.progress, [1, 2, 3]);
}
