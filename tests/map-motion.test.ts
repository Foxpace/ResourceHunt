import { createGameEvent } from "./helpers/event-fixtures.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MapMotion,
  animatedBotPosition,
  animatedDronePosition,
  animatedGuardianPosition,
} from "../src/web/model/map-motion.ts";
import { createRenderSnapshot } from "./helpers/world-integration.ts";

test("consecutive frames interpolate movement without changing recorded positions", (context) => {
  // Given
  const previous = createRenderSnapshot(context);
  const current = structuredClone(previous);
  current.tick = 1;
  current.bots[0]!.position.x++;
  const motion = new MapMotion();
  motion.acceptSnapshot(previous, 0);
  motion.acceptSnapshot(current, 100);

  // When
  const position = animatedBotPosition(current.bots[0]!, motion.animation(180));

  // Then
  assert.ok(position.x > previous.bots[0]!.position.x);
  assert.ok(position.x < current.bots[0]!.position.x);
  assert.equal(current.bots[0]!.position.x, previous.bots[0]!.position.x + 1);
});

test("backward seeking drops movement interpolation", (context) => {
  // Given
  const later = createRenderSnapshot(context, 2);
  const earlier = structuredClone(later);
  earlier.tick = 0;
  const motion = new MapMotion();
  motion.acceptSnapshot(later, 0);

  // When
  motion.acceptSnapshot(earlier, 100);

  // Then
  assert.equal(motion.animation(120).previous, undefined);
  assert.deepEqual(
    animatedBotPosition(earlier.bots[0]!, motion.animation(120)),
    earlier.bots[0]!.position,
  );
});

test("reduced motion disables movement tweening, ambient time, and bursts", (context) => {
  // Given
  const snapshot = createRenderSnapshot(context);
  const motion = new MapMotion();
  motion.acceptSnapshot(snapshot, 100);

  // When
  const animation = motion.animation(110, true);

  // Then
  assert.equal(animation.progress, 1);
  assert.equal(animation.effectProgress, 1);
  assert.equal(animation.time, 0);
});

test("re-rendering the same frame does not restart transient effects", (context) => {
  // Given
  const snapshot = createRenderSnapshot(context);
  const motion = new MapMotion();
  motion.acceptSnapshot(snapshot, 0);

  // When
  motion.acceptSnapshot(snapshot, 800);
  const animation = motion.animation(900);

  // Then
  assert.equal(animation.effectProgress, 1);
});

test("drone movement also interpolates between recorded frames", (context) => {
  // Given
  const previous = createRenderSnapshot(context);
  const current = structuredClone(previous);
  current.tick = 1;
  current.world.drones[0]!.position.x++;
  const motion = new MapMotion();
  motion.acceptSnapshot(previous, 0);
  motion.acceptSnapshot(current, 100);

  // When
  const position = animatedDronePosition(current.world.drones[0]!, motion.animation(180));

  // Then
  assert.ok(position.x > previous.world.drones[0]!.position.x);
  assert.ok(position.x < current.world.drones[0]!.position.x);
});

test("effects persist across following frames instead of flashing for a single tick", (context) => {
  // Given
  const first = createRenderSnapshot(context, 1);
  first.events = [createGameEvent()];
  const next = { ...first, tick: 2, events: [] };
  const motion = new MapMotion();
  motion.acceptSnapshot(first, 100);

  // When
  motion.acceptSnapshot(next, 200);
  const effects = motion.animation(300).effects;

  // Then
  assert.equal(effects.length, 1);
  assert.equal(effects[0]!.event.message, "Banked +7");
  assert.ok(effects[0]!.progress > 0);
});

test("seeking backward discards effects from future frames", (context) => {
  // Given
  const later = createRenderSnapshot(context, 2);
  later.events = [createGameEvent({ tick: 2 })];
  const earlier = { ...later, tick: 0, events: [] };
  const motion = new MapMotion();
  motion.acceptSnapshot(later, 100);

  // When
  motion.acceptSnapshot(earlier, 200);

  // Then
  assert.deepEqual(motion.animation(300).effects, []);
});

test("the guardian moves between frames while its cache stays fixed", (context) => {
  // Given
  const previous = createRenderSnapshot(context);
  const current = structuredClone(previous);
  current.tick = 1;
  const cache = current.world.caches[0]!;
  cache.guardianPosition = { ...cache.position, x: cache.position.x + 1 };
  const motion = new MapMotion();
  motion.acceptSnapshot(previous, 0);
  motion.acceptSnapshot(current, 100);

  // When
  const position = animatedGuardianPosition(cache, motion.animation(180));

  // Then
  assert.ok(position.x > cache.position.x);
  assert.ok(position.x < cache.guardianPosition.x);
});
