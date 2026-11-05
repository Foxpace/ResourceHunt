import { test } from "node:test";
import assert from "node:assert/strict";
import { assertPlayback, createLivePlayback } from "./helpers/playback-fixtures.ts";

test("concurrent step requests share one live tick", async (context) => {
  // Given
  const { client, playback } = await createLivePlayback(context);

  // When
  const firstStep = playback.step();
  const repeatedStep = playback.step();
  await firstStep;

  // Then
  assert.equal(repeatedStep, firstStep);
  assert.equal(client.steps, 1);
  assertPlayback(playback, { tick: 1 });
});

test("scrubbing recorded history does not advance the live engine", async (context) => {
  // Given
  const { client, playback } = await createLivePlayback(context);
  await playback.step();

  // When
  await playback.seek(0);
  const wasReplay = playback.isReplay;
  await playback.step();

  // Then
  assert.equal(wasReplay, true);
  assert.equal(client.steps, 1);
  assertPlayback(playback, { tick: 1 });
});

test("stepping past recorded history resumes the live engine", async (context) => {
  // Given
  const { client, playback } = await createLivePlayback(context);
  await playback.step();
  await playback.seek(0);
  await playback.step();

  // When
  await playback.step();

  // Then
  assert.equal(client.steps, 2);
  assertPlayback(playback, { tick: 2 });
});

test("seeking during a tick waits and preserves the requested frame", async (context) => {
  // Given
  const { playback } = await createLivePlayback(context);
  const pendingStep = playback.step();

  // When
  await playback.seek(0);
  await pendingStep;

  // Then
  assertPlayback(playback, { tick: 0, length: 2, busy: false });
});

for (const source of ["live", "imported"] as const) {
  test(`seeking beyond a partial ${source} match clamps to recorded ticks`, async (context) => {
    // Given
    const { client, playback } = await createLivePlayback(context, { ticks: 10 });
    await playback.step();
    if (source === "imported") await playback.load(await playback.export());

    // When
    await playback.seek(10);

    // Then
    assertPlayback(playback, { tick: 1 });
    assert.equal(playback.snapshot!.config.ticks, 10);
    assert.equal(client.steps, 1);
    if (source === "imported") assert.equal(playback.canStep, false);
  });
}

test("live and imported playback reach identical final states", async (context) => {
  // Given
  const { client, playback } = await createLivePlayback(context);
  await playback.play(() => 1000);
  const finalSnapshot = playback.snapshot;
  const replay = await playback.export();
  await playback.load(replay);

  // When
  await playback.play(() => 1000);

  // Then
  assert.deepEqual(playback.snapshot, finalSnapshot);
  assert.equal(finalSnapshot!.finished, true);
  assert.equal(client.steps, 3);
  assertPlayback(playback, { playing: false });
  assert.deepEqual(await playback.export(), replay);
});

test("importing releases the live session and resets the cursor", async (context) => {
  // Given
  const { client, playback } = await createLivePlayback(context);
  await playback.step();
  const replay = await playback.export();

  // When
  await playback.load(replay);

  // Then
  assert.equal(client.releases, 1);
  assertPlayback(playback, { tick: 0 });
});

test("disposing releases the live session exactly once", async (context) => {
  // Given
  const { client, playback } = await createLivePlayback(context);

  // When
  await playback.dispose();
  await playback.dispose();

  // Then
  assert.equal(client.releases, 1);
});
