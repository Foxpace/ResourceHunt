import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { Playback } from "../../src/web/model/playback.ts";
import type { GameConfig } from "../../src/engine/types.ts";
import { ControlledGameClient } from "./controlled-game-client.ts";
import { LocalGameClient, recordLocalReplay } from "./local-game-client.ts";
import { createMatchRequest } from "./game-fixtures.ts";
import { deferred } from "./deferred.ts";

export function createLocalPlayback(context: TestContext) {
  const client = new LocalGameClient();
  const playback = new Playback(client);
  context.after(() => playback.dispose());

  return { client, playback };
}

export async function createLivePlayback(context: TestContext, config: Partial<GameConfig> = {}) {
  const fixture = createLocalPlayback(context);
  await fixture.playback.create(createMatchRequest("test", config));

  return fixture;
}

export function createRecordedReplay(seed: string) {
  return recordLocalReplay(createMatchRequest(seed));
}

export class ControlledPlaybackFixture {
  readonly client = new ControlledGameClient();
  readonly playback = new Playback(this.client);
  private nextCreationIndex = 0;

  constructor(context: TestContext) {
    context.after(async () => {
      this.client.stepGate?.resolve();
      this.client.exportGate?.resolve();
      for (const gate of this.client.releaseGates.values()) gate.resolve();

      await this.playback.dispose();
    });
  }

  async beginCreation(seed = "live-match") {
    const index = this.nextCreationIndex++;
    const completion = this.playback.create(createMatchRequest(seed));
    const pending = await this.client.whenCreating(index);

    return {
      completion,
      pending,
      finish: async () => {
        this.client.finishCreation(index);
        await completion;
      },
    };
  }

  async createLiveMatch(seed = "live-match"): Promise<void> {
    const creation = await this.beginCreation(seed);
    await creation.finish();
  }

  async beginTick(mode: "step" | "play" = "step") {
    const gate = deferred<void>();
    this.client.stepGate = gate;
    const completion = mode === "step" ? this.playback.step() : this.playback.play(() => 1000);
    await this.client.stepStarted.promise;

    return { gate, completion };
  }

  async beginExport() {
    this.client.exportGate = deferred<void>();
    const completion = this.playback.export();
    await this.client.exportStarted.promise;

    return { completion, gate: this.client.exportGate };
  }

  async loadReplay(seed: string): Promise<void> {
    await this.playback.load(await createRecordedReplay(seed));
  }
}

interface PlaybackStatus {
  seed?: string;
  tick?: number;
  index: number;
  length: number;
  replay: boolean;
  busy: boolean;
  creating: boolean;
  playing: boolean;
  canPlay: boolean;
  canStep: boolean;
}

export function assertPlayback(playback: Playback, expected: Partial<PlaybackStatus>): void {
  assert.partialDeepStrictEqual(
    {
      seed: playback.snapshot?.config.seed,
      tick: playback.snapshot?.tick,
      index: playback.index,
      length: playback.length,
      replay: playback.isReplay,
      busy: playback.isBusy,
      creating: playback.isCreating,
      playing: playback.isPlaying,
      canPlay: playback.canPlay,
      canStep: playback.canStep,
    },
    expected,
  );
}

export function countNotifications(source: { subscribe(listener: () => void): () => void }) {
  const notifications = { count: 0 };
  source.subscribe(() => {
    notifications.count++;
  });

  return notifications;
}

export async function createEventReplay() {
  const replay = await createRecordedReplay("event-history");
  replay.frames[0]!.events = ["first", "second"].map((message) => ({
    tick: 1,
    botId: "test",
    kind: "action",
    message,
  }));
  replay.frames[1]!.events = [{ tick: 2, botId: "test", kind: "score", message: "third" }];

  return replay;
}

export async function beginCreationWithDelayedCleanup(fixture: ControlledPlaybackFixture) {
  const gate = deferred<void>();
  fixture.client.releaseGates.set("session-0", gate);
  const published = deferred<void>();
  const unsubscribe = fixture.playback.subscribe(() => {
    if (fixture.playback.snapshot?.config.seed === "intermediate-match") published.resolve();
  });
  const creation = await fixture.beginCreation("intermediate-match");
  fixture.client.finishCreation(1);
  await published.promise;
  unsubscribe();

  return { gate, completion: creation.completion };
}

export function assertImportedPlayback(playback: Playback, seed: string, tick = 0): void {
  assertPlayback(playback, { seed, tick, replay: true, busy: false, creating: false });
}

export function assertDisposedPlayback(
  playback: Playback,
  expected: Partial<PlaybackStatus> = {},
): void {
  assertPlayback(playback, {
    busy: false,
    playing: false,
    canPlay: false,
    canStep: false,
    ...expected,
  });
}
