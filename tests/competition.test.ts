import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSteal,
  getBankingSites,
  getNearestBank,
  getStealTargets,
  planTrip,
  samePosition,
} from "../src/sdk.ts";
import { normalizeConfig, parseReplay } from "../src/index.ts";
import { configFromFlags, parseArguments } from "../src/cli/options.ts";
import {
  advanceGame,
  advanceUntil,
  createObservationFromSnapshot,
} from "./helpers/game-fixtures.ts";
import {
  createCapturingGame,
  createContestedOutpost,
  createOwnedBankTrip,
  createSafeBaseGame,
  createTheftObservation,
  TheftScenario,
} from "./helpers/competition-scenarios.ts";
import { createLegacyCompetitionReplay } from "./helpers/replay-fixtures.ts";

test("skipping a turn resets capture progress", async (context) => {
  // Given
  const scenario = await createCapturingGame(context);

  // When
  scenario.mode = "skip";
  await scenario.game.step();

  // Then
  assert.equal(scenario.game.snapshot().outposts[0]!.captureProgress, 0);
});

test("capture restarts at one after an interruption", async (context) => {
  // Given
  const scenario = await createCapturingGame(context);
  scenario.mode = "skip";
  await scenario.game.step();

  // When
  scenario.mode = "capture";
  await scenario.game.step();

  // Then
  assert.equal(scenario.game.snapshot().outposts[0]!.captureProgress, 1);
  assert.equal(scenario.game.snapshot().outposts[0]!.ownerId, null);
});

test("three consecutive capture turns claim an outpost", async (context) => {
  // Given
  const scenario = await createCapturingGame(context);

  // When
  await advanceGame(scenario.game, 2);

  // Then
  assert.equal(scenario.game.snapshot().outposts[0]!.ownerId, "a");
  assert.equal(scenario.game.snapshot().bots[0]!.captures, 1);
  assert.equal(scenario.game.result().standings[0]!.outpostsOwned, 1);
});

test("capturing an already owned outpost cannot farm capture credit", async (context) => {
  // Given
  const scenario = await createCapturingGame(context);
  await advanceGame(scenario.game, 2);

  // When
  await scenario.game.step();

  // Then
  assert.equal(scenario.game.snapshot().bots[0]!.captures, 1);
  assert.equal(scenario.game.snapshot().bots[0]!.errors, 0);
});

test("both competitors can reach an outpost without banking their cargo", async (context) => {
  // Given
  const scenario = await createContestedOutpost(context);

  // When
  const bots = scenario.game.snapshot().bots;

  // Then
  assert.ok(bots.every((bot) => bot.score === 0));
  assert.ok(bots.every((bot) => bot.inventory.length === 2));
});

test("contested outposts cannot be captured", async (context) => {
  // Given
  const scenario = await createContestedOutpost(context);

  // When
  await scenario.contest();

  // Then
  assert.equal(scenario.game.snapshot().outposts[0]!.captureProgress, 0);
  assert.equal(scenario.game.snapshot().outposts[0]!.ownerId, null);
});

test("claiming an outpost banks cargo only for its owner", async (context) => {
  // Given
  const scenario = await createContestedOutpost(context);
  await scenario.contest();

  // When
  await scenario.claimFor("a");

  // Then
  assert.equal(scenario.observe("a").self.score, 14);
  assert.equal(scenario.observe("b").self.score, 0);
  assert.equal(getNearestBank(scenario.observe("a"))!.site.id, "outpost-1");
  assert.equal(getBankingSites(scenario.observe("a")).length, 2);
});

test("reclaiming an outpost transfers banking access and records both captures", async (context) => {
  // Given
  const scenario = await createContestedOutpost(context);
  await scenario.claimFor("a");

  // When
  await scenario.claimFor("b");

  // Then
  assert.equal(scenario.observe("b").self.score, 14);
  assert.equal(getBankingSites(scenario.observe("a")).length, 1);
  assert.ok(scenario.game.snapshot().bots.every((bot) => bot.captures === 1));
  assert.ok(scenario.game.snapshot().bots.every((bot) => bot.errors === 0));
});

test("replay ownership survives import and unknown owners are rejected", async (context) => {
  // Given
  const scenario = await createContestedOutpost(context);
  await scenario.claimFor("a");
  await scenario.claimFor("b");

  // When
  const replay = parseReplay(scenario.game.replay());
  const owner = replay.frames.at(-1)!.outposts[0]!.ownerId;
  replay.frames.at(-1)!.outposts[0]!.ownerId = "unknown";

  // Then
  assert.equal(owner, "b");
  assert.throws(() => parseReplay(replay));
});

test("theft transfers exactly one item without creating cargo", async (context) => {
  // Given
  const scenario = new TheftScenario(context);

  // When
  await scenario.stealUnits(1);
  const snapshot = scenario.game.snapshot();

  // Then
  assert.equal(snapshot.bots[0]!.inventory.length + snapshot.bots[1]!.inventory.length, 2);
  assert.equal(snapshot.bots[0]!.lost, 1);
  assert.equal(snapshot.bots[1]!.score, 0);
  assert.equal(snapshot.bots[1]!.stealReadyTick, snapshot.tick - 1 + 5);
});

test("a theft gives the victim escape protection and the thief a cooldown", async (context) => {
  // Given
  const scenario = new TheftScenario(context);
  await scenario.stealUnits(1);

  // When
  const victimCanSteal = canSteal(scenario.observe("victim"), "thief");
  const thiefCanSteal = canSteal(scenario.observe("thief"), "victim");

  // Then
  assert.equal(victimCanSteal, false);
  assert.equal(thiefCanSteal, false);
});

test("the thief must wait five turns between successful thefts", async (context) => {
  // Given
  const scenario = new TheftScenario(context);
  await scenario.stealUnits(1);
  const firstTheftTick = scenario.game.snapshot().tick - 1;

  // When
  await scenario.stealUnits(2);

  // Then
  assert.deepEqual(scenario.stealTicks, [firstTheftTick, firstTheftTick + 5]);
  assert.equal(scenario.observe("victim").self.inventory.length, 0);
});

test("returning home banks stolen cargo and preserves theft statistics", async (context) => {
  // Given
  const scenario = new TheftScenario(context);
  await scenario.stealUnits(2);

  // When
  scenario.returnHome = true;
  await advanceUntil(scenario.game, (snapshot) => snapshot.bots[1]!.score === 14);

  // Then
  assert.equal(scenario.observe("thief").self.score, 14);
  assert.ok(scenario.game.snapshot().bots.every((bot) => bot.errors === 0));
  const thief = scenario.game.result().standings.find((bot) => bot.id === "thief")!;
  assert.equal(thief.stolen, 2);
  assert.equal(thief.statistics?.stolenValue, 14);
});

test("base tiles protect visiting rivals carrying cargo", async (context) => {
  // Given
  const game = createSafeBaseGame(context);
  await advanceUntil(game, (snapshot) =>
    samePosition(snapshot.bots[0]!.position, snapshot.bots[1]!.base),
  );

  // When
  await advanceGame(game, 3);
  const snapshot = game.snapshot();

  // Then
  assert.equal(snapshot.bots[0]!.inventory.length, 2);
  assert.equal(snapshot.bots[1]!.score, 0);
  assert.deepEqual(getStealTargets(createObservationFromSnapshot(snapshot, "thief")), []);
});

test("theft selection chooses the highest-value item that fits", (context) => {
  // Given
  const state = createTheftObservation(context);

  // When
  const targets = getStealTargets(state);

  // Then
  assert.deepEqual(targets, [{ botId: "b", kind: "crystal", value: 7, weight: 2 }]);
});

test("theft reaches one orthogonal step and keeps both base tiles safe", (context) => {
  // Given
  const state = createTheftObservation(context);
  const victim = state.bots[1]!;
  victim.position = { x: state.self.position.x + 1, y: state.self.position.y };

  // When
  const adjacent = canSteal(state, victim.id);
  victim.base = { ...victim.position };
  const atBase = canSteal(state, victim.id);

  // Then
  assert.equal(adjacent, true);
  assert.equal(atBase, false);
});

for (const restriction of ["disabled theft", "cooldown", "escape protection"] as const) {
  test(`the SDK rejects theft during ${restriction}`, (context) => {
    // Given
    const state = createTheftObservation(context);
    if (restriction === "disabled theft") state.config.stealing = false;
    if (restriction === "cooldown") state.self.stealReadyTick = 1;
    if (restriction === "escape protection") state.bots[1]!.theftProtectedUntilTick = 1;

    // When
    const allowed = canSteal(state, "b");

    // Then
    assert.equal(allowed, false);
  });
}

test("trip plans use owned outposts as closer banks", (context) => {
  // Given
  const { state, outpost, pile } = createOwnedBankTrip(context);

  // When
  const trip = planTrip(state, pile);

  // Then
  assert.equal(trip.bank!.id, outpost.id);
});

test("trip plans stop using an outpost after ownership changes", (context) => {
  // Given
  const { state, outpost, pile } = createOwnedBankTrip(context);
  outpost.ownerId = null;

  // When
  const trip = planTrip(state, pile);

  // Then
  assert.equal(trip.bank!.kind, "base");
});

test("legacy replay imports add neutral defaults without mutating the input", async (context) => {
  // Given
  const legacy = await createLegacyCompetitionReplay(context);

  // When
  const replay = parseReplay(legacy);

  // Then
  assert.deepEqual(replay.initial.outposts, []);
  assert.equal(replay.initial.config.stealing, false);
  assert.equal(replay.initial.bots[0]!.stolen, 0);
  assert.equal(legacy.initial.outposts, undefined);
});

test("competitive settings are configurable through the CLI", () => {
  // Given
  const argumentsList =
    "play --hotspots 3 --outposts 1 --capture-turns 2 --stealing false --steal-cooldown 7".split(
      " ",
    );

  // When
  const config = configFromFlags(parseArguments(argumentsList).flags);

  // Then
  assert.partialDeepStrictEqual(config, {
    hotspotCount: 3,
    outpostCount: 1,
    captureTurns: 2,
    stealing: false,
    stealCooldownTicks: 7,
  });
});

for (const scenario of [
  { name: "too many hotspots", parse: () => normalizeConfig({ hotspotCount: 7 }) },
  { name: "zero capture turns", parse: () => normalizeConfig({ captureTurns: 0 }) },
  {
    name: "an invalid stealing flag",
    parse: () => configFromFlags(parseArguments(["--stealing", "yes"]).flags),
  },
]) {
  test(`competitive settings reject ${scenario.name}`, () => {
    // Given
    const parse = scenario.parse;

    // When
    const readConfiguration = () => parse();

    // Then
    assert.throws(readConfiguration);
  });
}
