import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "../src/engine/game.ts";
import type { CreateGameRequest } from "../src/http/types.ts";
import type { GameClient } from "../src/web/client.ts";
import { Playback } from "../src/web/playback.ts";
import { normalizeConfig } from "../src/engine/config.ts";

/** Run playback against the real engine without requiring a browser or HTTP server. */
class LocalGameClient implements GameClient {
  game?: Game;
  steps = 0;
  releases = 0;

  async create(request: CreateGameRequest) {
    this.game = new Game(
      request.botIds.map((id) => ({
        metadata: { id, name: id, description: "Playback test" },
        async decide() {
          return { action: { type: "skip" } };
        },
        dispose() {},
      })),
      request.config,
    );
    return { id: "local", snapshot: this.game.snapshot() };
  }
  async step() {
    this.steps++;
    return { snapshot: await this.game!.step() };
  }
  async replay() {
    return this.game!.replay();
  }
  async release() {
    this.releases++;
    this.game!.dispose();
  }
}

const request = { botIds: ["test"], config: normalizeConfig({ ticks: 3, width: 13, height: 13 }) };

test("playback serializes live ticks and scrubs history without advancing the engine", async () => {
  const client = new LocalGameClient();
  const playback = new Playback(client);
  try {
    await playback.create(request);
    const first = playback.step();
    assert.strictEqual(playback.step(), first);
    await first;
    assert.strictEqual(client.steps, 1);
    assert.strictEqual(playback.snapshot!.tick, 1);
    await playback.seek(0);
    assert.strictEqual(playback.isReplay, true);
    await playback.step();
    assert.strictEqual(client.steps, 1);
    assert.strictEqual(playback.snapshot!.tick, 1);
    await playback.step();
    assert.strictEqual(client.steps, 2);
  } finally {
    await playback.dispose();
  }
  assert.strictEqual(client.releases, 1);
});

test("seeking during a live tick waits for it, then preserves the requested frame", async () => {
  const playback = new Playback(new LocalGameClient());
  try {
    await playback.create(request);
    const step = playback.step();
    await playback.seek(0);
    await step;
    assert.strictEqual(playback.snapshot!.tick, 0);
    assert.strictEqual(playback.length, 2);
    assert.strictEqual(playback.isBusy, false);
  } finally {
    await playback.dispose();
  }
});

test("seeking beyond recorded ticks clamps without advancing live or partial replay matches", async () => {
  const client = new LocalGameClient();
  const playback = new Playback(client);
  try {
    await playback.create({ ...request, config: { ...request.config, ticks: 10 } });
    await playback.step();
    await playback.seek(10);
    assert.strictEqual(playback.snapshot!.tick, 1);
    assert.strictEqual(client.steps, 1);

    await playback.seek(0);
    assert.strictEqual(playback.snapshot!.tick, 0);
    await playback.step();
    assert.strictEqual(playback.snapshot!.tick, 1);
    assert.strictEqual(client.steps, 1);

    const replay = await playback.export();
    await playback.load(replay);
    await playback.seek(10);
    assert.strictEqual(playback.snapshot!.tick, 1);
    assert.strictEqual(playback.snapshot!.config.ticks, 10);
    assert.strictEqual(playback.canStep, false);
    assert.strictEqual(client.steps, 1);
  } finally {
    await playback.dispose();
  }
});

test("live and imported playback reach the same final state without rerunning decisions", async () => {
  const client = new LocalGameClient();
  const playback = new Playback(client);
  try {
    await playback.create(request);
    await playback.play(() => 1000);
    const final = playback.snapshot;
    assert.strictEqual(final!.finished, true);
    assert.strictEqual(playback.isPlaying, false);
    const replay = await playback.export();
    await playback.load(replay);
    assert.strictEqual(client.releases, 1);
    assert.strictEqual(playback.snapshot!.tick, 0);
    await playback.play(() => 1000);
    assert.deepStrictEqual(playback.snapshot, final);
    assert.strictEqual(client.steps, 3);
    assert.deepStrictEqual(await playback.export(), replay);
  } finally {
    await playback.dispose();
  }
});
