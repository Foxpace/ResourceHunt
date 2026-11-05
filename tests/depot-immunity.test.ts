import { removeLegacyDepotProtection } from "./helpers/replay-fixtures.ts";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canCapture,
  canSabotage,
  isOutpostProtected,
  parseReplay,
  normalizeConfig,
} from "../src/index.ts";
import { advanceGame } from "./helpers/game-fixtures.ts";
import { createContestedOutpost } from "./helpers/competition-scenarios.ts";
import { WorldScenario } from "./helpers/world-fixtures.ts";
import { configFromFlags, parseArguments } from "../src/cli/options.ts";

test("each captured depot grants three complete following rounds of protection", async (context) => {
  // Given
  const scenario = await createContestedOutpost(context);
  await scenario.claimFor("a");
  const capturedAt = scenario.game.snapshot().tick;

  // When
  scenario.phase = "reclaim";
  await advanceGame(scenario.game, 3);
  const snapshot = scenario.game.snapshot();

  // Then
  assert.equal(snapshot.outposts[0]!.captureProtectedUntilTick, capturedAt + 3);
  assert.equal(snapshot.outposts[0]!.ownerId, "a");
  assert.equal(snapshot.outposts[0]!.captureProgress, 0);
  assert.equal(canCapture(scenario.observe("b")), true);
});

test("a rival can recapture the depot after its protection expires", async (context) => {
  // Given
  const scenario = await createContestedOutpost(context);
  await scenario.claimFor("a");

  // When
  await scenario.claimFor("b");
  const snapshot = scenario.game.snapshot();

  // Then
  assert.equal(snapshot.outposts[0]!.ownerId, "b");
  assert.equal(snapshot.outposts[0]!.captureProtectedUntilTick, snapshot.tick + 3);
  assert.ok(snapshot.bots.every((bot) => bot.captures === 1));
  assert.ok(snapshot.bots.every((bot) => bot.errors === 0));
  assert.deepEqual(parseReplay(scenario.game.replay()), scenario.game.replay());
});

for (const tick of [10, 11, 12, 13]) {
  test(`depot capture and sabotage respect protection on tick ${tick}`, () => {
    // Given
    const scenario = new WorldScenario();
    scenario.depot.captureProtectedUntilTick = 13;
    scenario.context.tick = tick;
    scenario.attacker.position = { x: 6, y: 6 };
    scenario.defender.position = scenario.defender.base;

    // When
    const observation = scenario.observe();

    // Then
    assert.equal(canCapture(observation), tick >= 13);
    assert.equal(canSabotage(observation, "outpost-1"), tick >= 13);
    assert.equal(isOutpostProtected(scenario.depot, tick), tick < 13);
  });
}

test("the engine blocks sabotage attempts while ownership is protected", () => {
  // Given
  const scenario = new WorldScenario();
  scenario.depot.captureProtectedUntilTick = 13;

  // When
  scenario.act({ type: "sabotage", targetId: "outpost-1" });

  // Then
  assert.equal(scenario.depot.sabotageProgress ?? 0, 0);
  assert.equal(scenario.depot.disabledUntilTick, undefined);
});

test("depot protection is configurable through the CLI", () => {
  // Given
  const flags = parseArguments(["play", "--capture-immunity", "5"]).flags;

  // When
  const config = configFromFlags(flags);

  // Then
  assert.equal(config.captureImmunityTicks, 5);
  assert.equal(normalizeConfig().captureImmunityTicks, 3);
});

for (const captureImmunityTicks of [-1, 1.5, 21]) {
  test(`configuration rejects an immunity duration of ${captureImmunityTicks}`, () => {
    // Given
    const input = { captureImmunityTicks };

    // When
    const configure = () => normalizeConfig(input);

    // Then
    assert.throws(configure);
  });
}

for (const captureImmunityTicks of [0, 1, 5]) {
  test(`captured depots use the configured ${captureImmunityTicks} protected rounds`, async (context) => {
    // Given
    const scenario = await createContestedOutpost(context, { captureImmunityTicks });
    await scenario.claimFor("a");

    // When
    const snapshot = scenario.game.snapshot();
    const protectionEnds = snapshot.outposts[0]!.captureProtectedUntilTick;

    // Then
    assert.equal(protectionEnds, captureImmunityTicks ? snapshot.tick + captureImmunityTicks : 0);
    assert.equal(
      isOutpostProtected(snapshot.outposts[0]!, snapshot.tick),
      captureImmunityTicks > 0,
    );
  });
}

test("older replays retain their original unprotected capture behavior", async (context) => {
  // Given
  const scenario = await createContestedOutpost(context);
  await scenario.claimFor("a");
  const legacy = removeLegacyDepotProtection(scenario.game.replay());

  // When
  const imported = parseReplay(legacy);

  // Then
  assert.equal(imported.initial.config.captureImmunityTicks, 0);
  assert.equal(
    isOutpostProtected(imported.frames.at(-1)!.outposts[0]!, imported.frames.at(-1)!.tick),
    false,
  );
});
