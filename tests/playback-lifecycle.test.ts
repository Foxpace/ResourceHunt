import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertPlayback,
  assertImportedPlayback,
  assertDisposedPlayback,
  ControlledPlaybackFixture,
  countNotifications,
  createRecordedReplay,
  beginCreationWithDelayedCleanup,
  createEventReplay,
} from "./helpers/playback-fixtures.ts";
import { createMatchRequest } from "./helpers/game-fixtures.ts";

test("an imported replay supersedes a pending creation and releases its late session", async (context) => {
  // Given
  const { playback, client } = new ControlledPlaybackFixture(context);
  const creation = playback.create(createMatchRequest("superseded-match"));
  await client.whenCreating(0);

  // When
  await playback.load(await createRecordedReplay("imported-replay"));
  client.finishCreation(0);
  await creation;
  await playback.step();

  // Then
  assertImportedPlayback(playback, "imported-replay", 1);
  assert.deepEqual(client.releases, ["session-0"]);
  assert.deepEqual(client.steps, []);
});

test("the latest creation wins when responses arrive in reverse order", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  const older = await fixture.beginCreation("older-match");
  const latest = await fixture.beginCreation("latest-match");

  // When
  await latest.finish();
  await older.finish();
  await fixture.playback.step();

  // Then
  assertPlayback(fixture.playback, { seed: "latest-match", busy: false });
  assert.deepEqual(fixture.client.releases, ["session-0"]);
  assert.deepEqual(fixture.client.steps, ["session-1"]);
});

test("a superseded response leaves the latest creation busy", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  const older = await fixture.beginCreation("older-match");
  await fixture.beginCreation("latest-match");

  // When
  await older.finish();

  // Then
  assertPlayback(fixture.playback, { busy: true, creating: true, seed: undefined });
});

test("a stale creation failure preserves the current replay", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  const creation = await fixture.beginCreation("failed-old-match");
  await fixture.loadReplay("surviving-replay");

  // When
  creation.pending.response.reject(new Error("Old request failed"));
  await assert.doesNotReject(creation.completion);

  // Then
  assertPlayback(fixture.playback, { seed: "surviving-replay", canPlay: true });
});

test("a failed replacement preserves the live match and recorded frames", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  await fixture.playback.step();
  const creation = await fixture.beginCreation("failed-replacement");

  // When
  creation.pending.response.reject(new Error("Creation failed"));
  await assert.rejects(creation.completion, /Creation failed/);

  // Then
  assertPlayback(fixture.playback, { seed: "live-match", tick: 1, length: 2, canStep: true });
  assert.deepEqual(fixture.client.releases, []);
});

test("the original live session can continue after a failed replacement", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const creation = await fixture.beginCreation("failed-replacement");
  creation.pending.response.reject(new Error("Creation failed"));
  await assert.rejects(creation.completion, /Creation failed/);

  // When
  await fixture.playback.step();

  // Then
  assertPlayback(fixture.playback, { tick: 1, canStep: true });
  assert.deepEqual(fixture.client.steps, ["session-0"]);
});

test("disposing during creation prevents revival from a late response", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  const notifications = countNotifications(fixture.playback);
  const creation = await fixture.beginCreation("late-session");
  await fixture.playback.dispose();
  const countAtDisposal = notifications.count;

  // When
  await creation.finish();

  // Then
  assertDisposedPlayback(fixture.playback, { seed: undefined, length: 0 });
  assert.equal(notifications.count, countAtDisposal);
  assert.deepEqual(fixture.client.releases, ["session-0"]);
});

test("a disposed playback rejects new creations and exports", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.playback.dispose();

  // When
  const creation = fixture.playback.create(createMatchRequest("after-disposal"));
  const exporting = fixture.playback.export();

  // Then
  await assert.rejects(creation, /disposed/);
  await assert.rejects(exporting, /disposed/);
});

test("disposing during a tick waits before releasing the busy session", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const tick = await fixture.beginTick();

  // When
  const disposal = fixture.playback.dispose();
  const releasesBeforeTickFinishes = [...fixture.client.releases];
  tick.gate.resolve();
  await Promise.all([tick.completion, disposal]);

  // Then
  assert.deepEqual(releasesBeforeTickFinishes, []);
  assert.deepEqual(fixture.client.releases, ["session-0"]);
  assertPlayback(fixture.playback, { canPlay: false, canStep: false });
});

test("disposing during a tick freezes published history and notifications", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const notifications = countNotifications(fixture.playback);
  const tick = await fixture.beginTick();
  const snapshotAtDisposal = structuredClone(fixture.playback.snapshot);
  const disposal = fixture.playback.dispose();
  const countAtDisposal = notifications.count;

  // When
  tick.gate.resolve();
  await Promise.all([tick.completion, disposal]);

  // Then
  assert.deepEqual(fixture.playback.snapshot, snapshotAtDisposal);
  assert.equal(notifications.count, countAtDisposal);
  assertPlayback(fixture.playback, { length: 1 });
});

test("step, seek, play, and repeated disposal cannot change a disposed source", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  await fixture.playback.dispose();
  const snapshotAtDisposal = structuredClone(fixture.playback.snapshot);
  const notifications = countNotifications(fixture.playback);

  // When
  await fixture.playback.step();
  await fixture.playback.seek(2);
  await fixture.playback.play(() => 1000);
  await fixture.playback.dispose();

  // Then
  assert.deepEqual(fixture.playback.snapshot, snapshotAtDisposal);
  assert.equal(notifications.count, 0);
  assert.deepEqual(fixture.client.releases, ["session-0"]);
});

test("importing during a tick pauses the old play loop immediately", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const tick = await fixture.beginTick("play");
  const replay = await createRecordedReplay("replacement-replay");

  // When
  const importing = fixture.playback.load(replay);
  const statusDuringImport = { playing: fixture.playback.isPlaying, busy: fixture.playback.isBusy };
  tick.gate.resolve();
  await Promise.all([tick.completion, importing]);

  // Then
  assert.deepEqual(statusDuringImport, { playing: false, busy: true });
  assertPlayback(fixture.playback, { seed: "replacement-replay", tick: 0, length: 3 });
  assert.deepEqual(fixture.client.steps, ["session-0"]);
  assert.deepEqual(fixture.client.releases, ["session-0"]);
});

test("a source changed during export invalidates its download", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const exporting = await fixture.beginExport();
  const rejection = assert.rejects(exporting.completion, /source changed/);

  // When
  await fixture.loadReplay("new-source");
  exporting.gate.resolve();
  await rejection;

  // Then
  assertPlayback(fixture.playback, { seed: "new-source" });
});

test("disposal invalidates an export already sent to the server", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const exporting = await fixture.beginExport();
  const rejection = assert.rejects(exporting.completion, /disposed/);
  const snapshotAtDisposal = structuredClone(fixture.playback.snapshot);

  // When
  await fixture.playback.dispose();
  exporting.gate.resolve();
  await rejection;

  // Then
  assert.deepEqual(fixture.playback.snapshot, snapshotAtDisposal);
  assertPlayback(fixture.playback, { canPlay: false });
  assert.deepEqual(fixture.client.releases, ["session-0"]);
});

test("a seek waiting on an old tick cannot move an imported replay cursor", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const tick = await fixture.beginTick();
  const replay = await createRecordedReplay("new-timeline");

  // When
  const seeking = fixture.playback.seek(2);
  const importing = fixture.playback.load(replay);
  tick.gate.resolve();
  await Promise.all([tick.completion, seeking, importing]);

  // Then
  assertPlayback(fixture.playback, { seed: "new-timeline", index: 0, tick: 0 });
});

test("a failed old tick cannot block an import or restart its play loop", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const tick = await fixture.beginTick("play");
  const replay = await createRecordedReplay("recovered-source");

  // When
  const importing = fixture.playback.load(replay);
  tick.gate.reject(new Error("Old tick failed"));
  await assert.doesNotReject(Promise.all([tick.completion, importing]));

  // Then
  assertPlayback(fixture.playback, { seed: "recovered-source", tick: 0 });
  assertPlayback(fixture.playback, { playing: false, canStep: true });
  assert.deepEqual(fixture.client.steps, ["session-0"]);
  assert.deepEqual(fixture.client.releases, ["session-0"]);
});

test("superseded cleanup cannot overwrite a newer source", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const replacement = await beginCreationWithDelayedCleanup(fixture);

  // When
  await fixture.loadReplay("newest-replay");
  replacement.gate.resolve();
  await replacement.completion;

  // Then
  assertPlayback(fixture.playback, { seed: "newest-replay", busy: false });
  assert.deepEqual(fixture.client.releases, ["session-0", "session-1"]);
});

for (const scenario of [
  { target: 100, index: 2, messages: ["third", "second"], limit: 2 },
  { target: 1, index: 1, messages: ["second", "first"], limit: 20 },
  { target: -10, index: 0, messages: [], limit: 20 },
]) {
  test(`recorded event navigation clamps frame ${scenario.target} without live ticks`, async (context) => {
    // Given
    const fixture = new ControlledPlaybackFixture(context);
    await fixture.playback.load(await createEventReplay());

    // When
    await fixture.playback.seek(scenario.target);
    const messages = fixture.playback.recentEvents(scenario.limit).map((event) => event.message);

    // Then
    assertPlayback(fixture.playback, { index: scenario.index });
    assert.deepEqual(messages, scenario.messages);
    assert.deepEqual(fixture.client.steps, []);
  });
}

test("a failed replacement keeps the tick completed while it was pending", async (context) => {
  // Given
  const fixture = new ControlledPlaybackFixture(context);
  await fixture.createLiveMatch();
  const tick = await fixture.beginTick();

  // When
  const creation = fixture.beginCreation("failed-replacement");
  tick.gate.resolve();
  await tick.completion;
  const pending = await creation;
  pending.pending.response.reject(new Error("Creation failed"));

  // Then
  await assert.rejects(pending.completion, /Creation failed/);
  assertPlayback(fixture.playback, { seed: "live-match", tick: 1, length: 2, canStep: true });
  assert.deepEqual(fixture.client.releases, []);
});
