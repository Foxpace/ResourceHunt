import { test } from "node:test";
import assert from "node:assert/strict";
import { createMatchRequest } from "./helpers/game-fixtures.ts";
import {
  assertPlayback,
  countNotifications,
  createRecordedReplay,
} from "./helpers/playback-fixtures.ts";
import {
  CatalogGameClient,
  ControlledApplicationFixture,
  createApplication,
  createLiveApplication,
  createReplayFile,
  createPendingReplayFile,
  captureExport,
  createSupersededGeneration,
  assertApplicationDisposed,
  createDisposingExport,
} from "./helpers/application-fixtures.ts";

test("initial catalog refresh selects the default bots", async (context) => {
  // Given
  const { model } = createApplication(context, new CatalogGameClient());

  // When
  await model.dispatch({ type: "refreshBots", initial: true });

  // Then
  assert.deepEqual(model.state.selectedBotIds, ["first"]);
});

test("catalog refresh preserves available selections", async (context) => {
  // Given
  const { model } = createApplication(context, new CatalogGameClient());
  await model.dispatch({ type: "selectBots", botIds: ["second"] });

  // When
  await model.dispatch({ type: "refreshBots" });

  // Then
  assert.deepEqual(model.state.selectedBotIds, ["second"]);
});

test("removed bots clear selections and discovery errors reach the user", async (context) => {
  // Given
  const { model, client } = createApplication(context, new CatalogGameClient());
  await model.dispatch({ type: "selectBots", botIds: ["second"] });
  client.catalog.bots = client.catalog.bots.slice(0, 1);
  client.catalog.errors = [{ file: "broken.ts", error: "Invalid metadata" }];

  // When
  await model.dispatch({ type: "refreshBots" });

  // Then
  assert.deepEqual(model.state.selectedBotIds, []);
  assert.equal(model.state.canGenerate, false);
  assert.match(model.state.message, /broken.ts: Invalid metadata/);
});

test("dismissing a message clears the visible error", async (context) => {
  // Given
  const { model, client } = createApplication(context, new CatalogGameClient());
  client.catalog.errors = [{ file: "broken.ts", error: "Invalid metadata" }];
  await model.dispatch({ type: "refreshBots" });

  // When
  await model.dispatch({ type: "dismissMessage" });

  // Then
  assert.equal(model.state.message, "");
});

test("generation disables playback and ignores duplicate requests", async (context) => {
  // Given
  const fixture = new ControlledApplicationFixture(context);
  await fixture.beginGeneration();

  // When
  await fixture.model.dispatch({ type: "generateMatch", request: createMatchRequest() });

  // Then
  assert.equal(fixture.model.state.generating, true);
  assert.equal(fixture.model.playbackControls.canPlay, false);
  assert.equal(fixture.client.creationRequests, 1);
});

test("completed generation restores playback controls", async (context) => {
  // Given
  const fixture = new ControlledApplicationFixture(context);
  const generation = await fixture.beginGeneration();

  // When
  await generation.finish();

  // Then
  assert.equal(fixture.model.state.generating, false);
  assert.equal(fixture.model.playbackControls.canStep, true);
});

test("failed generation reports an error and keeps the previous match usable", async (context) => {
  // Given
  const fixture = new ControlledApplicationFixture(context);
  await (await fixture.beginGeneration()).finish();
  const generation = await fixture.beginGeneration("replacement");

  // When
  generation.pending.response.reject(new Error("Engine disconnected"));
  await generation.completion;

  // Then
  assert.equal(fixture.model.state.generating, false);
  assert.match(fixture.model.state.message, /Engine disconnected/);
  assert.equal(fixture.model.playbackControls.canStep, true);
});

test("export includes the frames already played", async (context) => {
  // Given
  const { model } = await createLiveApplication(context);

  // When
  const replay = await captureExport(model);

  // Then
  assert.equal(replay.frames.length, 1);
});

for (const scenario of [
  {
    name: "oversized files",
    file: {
      size: 51 * 1024 * 1024,
      text: async () => {
        throw new Error("Must not read");
      },
    },
    error: /smaller than 50 MB/,
  },
  { name: "invalid replay data", file: createReplayFile({}), error: /Invalid replay/ },
]) {
  test(`import rejects ${scenario.name} before replacing a live session`, async (context) => {
    // Given
    const { model, client } = await createLiveApplication(context);

    // When
    await model.dispatch({ type: "importReplay", file: scenario.file });

    // Then
    assert.match(model.state.message, scenario.error);
    assertPlayback(model.playback, { tick: 1 });
    assert.equal(client.releases, 0);
  });
}

test("importing an exported replay releases the live session and resets playback", async (context) => {
  // Given
  const { model, client } = await createLiveApplication(context);
  const replay = await captureExport(model);

  // When
  await model.dispatch({ type: "importReplay", file: createReplayFile(replay) });

  // Then
  assert.equal(client.releases, 1);
  assert.equal(model.playbackControls.isReplay, true);
  assertPlayback(model.playback, { tick: 0 });
});

test("failed replay downloads publish their error", async (context) => {
  // Given
  const { model } = await createLiveApplication(context);
  const saveReplay = () => {
    throw new Error("Download failed");
  };

  // When
  await model.dispatch({ type: "exportReplay", saveReplay });

  // Then
  assert.match(model.state.message, /Download failed/);
});

test("replay import restores controls while an older generation is pending", async (context) => {
  // Given
  const fixture = new ControlledApplicationFixture(context);
  await fixture.beginGeneration("older");

  // When
  await fixture.importReplay("imported");

  // Then
  assert.equal(fixture.model.state.generating, false);
  assert.equal(fixture.model.playbackControls.canPlay, true);
  assertPlayback(fixture.model.playback, { seed: "imported" });
});

test("a stale generation response cannot clear the latest busy state", async (context) => {
  // Given
  const { fixture, older } = await createSupersededGeneration(context);
  await fixture.beginGeneration("latest");

  // When
  await older.finish();

  // Then
  assert.equal(fixture.model.state.generating, true);
  assert.equal(fixture.model.playbackControls.canPlay, false);
  assertPlayback(fixture.model.playback, { seed: "imported" });
});

test("the latest generation restores controls after a stale response", async (context) => {
  // Given
  const { fixture, older } = await createSupersededGeneration(context);
  const latest = await fixture.beginGeneration("latest");
  await older.finish();

  // When
  await latest.finish();

  // Then
  assert.equal(fixture.model.state.generating, false);
  assert.equal(fixture.model.playbackControls.canStep, true);
  assertPlayback(fixture.model.playback, { seed: "latest" });
  assert.deepEqual(fixture.client.releases, ["session-0"]);
});

test("an older replay file read cannot replace a newer generation", async (context) => {
  // Given
  const fixture = new ControlledApplicationFixture(context);
  const pendingFile = createPendingReplayFile();
  const importing = fixture.model.dispatch({ type: "importReplay", file: pendingFile.file });
  await (await fixture.beginGeneration()).finish();

  // When
  pendingFile.read.resolve(JSON.stringify(await createRecordedReplay("older-import")));
  await importing;

  // Then
  assertPlayback(fixture.model.playback, { seed: "test", replay: false });
  assert.deepEqual(fixture.client.releases, []);
  assert.equal(fixture.model.state.message, "");
});

test("an older failed file read cannot replace a newer replay or publish an error", async (context) => {
  // Given
  const fixture = new ControlledApplicationFixture(context);
  const pendingFile = createPendingReplayFile();
  const importing = fixture.model.dispatch({ type: "importReplay", file: pendingFile.file });
  await fixture.importReplay("latest-import");

  // When
  pendingFile.read.reject(new Error("Old file read failed"));
  await importing;

  // Then
  assertPlayback(fixture.model.playback, { seed: "latest-import" });
  assert.equal(fixture.model.state.message, "");
});

test("disposal invalidates pending file reads and later application actions", async (context) => {
  // Given
  const fixture = new ControlledApplicationFixture(context);
  await fixture.importReplay("original");
  const pendingFile = createPendingReplayFile();
  const importing = fixture.model.dispatch({ type: "importReplay", file: pendingFile.file });
  const snapshotAtDisposal = structuredClone(fixture.model.playback.snapshot);
  await fixture.model.dispose();

  // When
  pendingFile.read.resolve(JSON.stringify(await createRecordedReplay("ignored")));
  await importing;
  await fixture.model.dispatch({ type: "selectBots", botIds: ["ignored"] });
  await fixture.model.dispatch({ type: "generateMatch", request: createMatchRequest() });

  // Then
  assert.deepEqual(fixture.model.playback.snapshot, snapshotAtDisposal);
  assertApplicationDisposed(fixture.model);
});

test("disposed applications stop publishing notifications", async (context) => {
  // Given
  const fixture = new ControlledApplicationFixture(context);
  const notifications = countNotifications(fixture.model);
  await fixture.model.dispose();
  const countAtDisposal = notifications.count;

  // When
  await fixture.model.dispatch({ type: "selectBots", botIds: ["ignored"] });
  await fixture.model.dispatch({ type: "generateMatch", request: createMatchRequest() });

  // Then
  assert.equal(notifications.count, countAtDisposal);
});

test("disposal between export completion and its callback prevents saving a file", async (context) => {
  // Given
  const { model, client, activity, saveReplay } = createDisposingExport(context);
  await model.dispatch({ type: "generateMatch", request: createMatchRequest() });

  // When
  await model.dispatch({ type: "exportReplay", saveReplay });
  await activity.disposal;

  // Then
  assert.equal(activity.saves, 0);
  assert.equal(model.state.message, "");
  assert.equal(client.releases, 1);
});

test("a file read completed after disposal cannot publish notifications", async (context) => {
  // Given
  const fixture = new ControlledApplicationFixture(context);
  const pendingFile = createPendingReplayFile();
  const importing = fixture.model.dispatch({ type: "importReplay", file: pendingFile.file });
  const notifications = countNotifications(fixture.model);
  await fixture.model.dispose();
  const countAtDisposal = notifications.count;

  // When
  pendingFile.read.resolve(JSON.stringify(await createRecordedReplay("ignored")));
  await importing;

  // Then
  assert.equal(notifications.count, countAtDisposal);
});
