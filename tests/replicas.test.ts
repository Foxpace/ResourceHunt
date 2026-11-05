import { test } from "node:test";
import assert from "node:assert/strict";
import { createBotLineup, runBenchmark, parseReplay, CLASSIC_WORLD_RULES } from "../src/index.ts";
import { selectBots } from "../src/runtime/bots.ts";
import { runToEnd } from "../src/runtime/matches.ts";
import {
  createBotCatalog,
  createReplicaConfig,
  createReplicaDescriptors,
  createReplicaGame,
} from "./helpers/replica-fixtures.ts";
import { createApplication, CatalogGameClient } from "./helpers/application-fixtures.ts";
import {
  createHttpMatch,
  finishHttpMatch,
  downloadHttpReplay,
  runCli,
} from "./helpers/runtime-fixtures.ts";
import { renderBotSelection } from "../src/web/view/panels.ts";

test("repeating a strategy creates separate participant IDs and labels", () => {
  // Given
  const catalog = createBotCatalog();

  // When
  const lineup = selectBots(catalog, ["scout", "scout", "raider"]);

  const identities = lineup.map((bot) => [bot.id, bot.name, bot.strategyId]);

  // Then
  assert.deepEqual(identities, [
    ["scout-copy-1", "scout #1", "scout"],
    ["scout-copy-2", "scout #2", "scout"],
    ["raider", "raider", undefined],
  ]);
  assert.equal(catalog.bots[0]!.id, "scout");
});

test("replica IDs cannot collide with another selected strategy", () => {
  // Given
  const catalog = createBotCatalog(["scout", "scout-copy-1"]);

  // When
  const lineup = selectBots(catalog, ["scout", "scout", "scout-copy-1"]);

  // Then
  assert.equal(new Set(lineup.map((bot) => bot.id)).size, 3);
  assert.equal(lineup[2]!.id, "scout-copy-1");
});

test("long replica IDs and names fit replay metadata limits", () => {
  // Given
  const catalog = createBotCatalog(["a".repeat(48), "a".repeat(47) + "b"]);
  for (const bot of catalog.bots) bot.name = "A".repeat(60);

  // When
  const lineup = createBotLineup([...catalog.bots, ...catalog.bots]);

  // Then
  assert.equal(new Set(lineup.map((bot) => bot.id)).size, 4);
  assert.ok(lineup.every((bot) => /^[a-z0-9][a-z0-9-]{0,47}$/.test(bot.id)));
  assert.ok(lineup.every((bot) => bot.name.length <= 60));
});

test("normalizing an existing lineup preserves its stable identities", () => {
  // Given
  const lineup = selectBots(createBotCatalog(), ["scout", "scout", "raider"]);

  // When
  const normalized = createBotLineup(lineup);

  // Then
  assert.deepEqual(normalized, lineup);
});

for (const ids of [[], Array<string>(16).fill("scout"), ["missing"]]) {
  test(`invalid lineups are rejected: ${ids.length} entries, ${ids[0] ?? "empty"}`, () => {
    // Given
    const catalog = createBotCatalog();

    // When
    const select = () => selectBots(catalog, ids);

    // Then
    assert.throws(select);
  });
}

test("worker replicas isolate module state and bank independently", async (context) => {
  // Given
  const game = await createReplicaGame(context);

  // When
  await runToEnd(game);

  // Then
  assert.deepEqual(game.result().botOrder, ["replica-copy-1", "replica-copy-2"]);
  assert.ok(game.result().standings.every((bot) => bot.score === 7));
  assert.ok(game.result().standings.every((bot) => bot.errors === 0));
  assert.equal(new Set(game.snapshot().bots.map((bot) => bot.color)).size, 2);
  assert.ok(game.snapshot().bots.every((bot) => bot.strategyId === "replica"));
});

test("replica identities and scores survive replay export and import", async (context) => {
  // Given
  const game = await createReplicaGame(context);
  await runToEnd(game);

  // When
  const replay = parseReplay(JSON.parse(JSON.stringify(game.replay())));

  // Then
  assert.deepEqual(replay, game.replay());
  assert.equal(new Set(replay.initial.bots.map((bot) => bot.id)).size, 2);
});

test("benchmark rotation keeps replica identities stable across base slots", async (context) => {
  // Given
  const bots = await createReplicaDescriptors(context);

  // When
  const benchmark = await runBenchmark(bots, createReplicaConfig(), { matches: 2 });

  // Then
  assert.deepEqual(benchmark.results[0]!.botOrder, ["replica-copy-1", "replica-copy-2"]);
  assert.deepEqual(benchmark.results[1]!.botOrder, ["replica-copy-2", "replica-copy-1"]);
  assert.ok(benchmark.standings.every((bot) => bot.meanScore === 7));
  assert.ok(benchmark.standings.every((bot) => bot.errors === 0));
});

test("the UI model stores requested copy counts and preserves them on refresh", async (context) => {
  // Given
  const { model } = createApplication(context, new CatalogGameClient());
  await model.dispatch({ type: "refreshBots", initial: true });

  // When
  await model.dispatch({ type: "setBotCopies", botId: "first", copies: 3 });
  await model.dispatch({ type: "refreshBots" });

  // Then
  assert.deepEqual(model.state.selectedBotIds, ["first", "first", "first"]);
  assert.equal(model.state.canGenerate, true);
});

test("lineup limits count replicas and keep suggested map sizes within bounds", async (context) => {
  // Given
  const { model } = createApplication(context, new CatalogGameClient());
  await model.dispatch({ type: "refreshBots", initial: true });

  // When
  await model.dispatch({ type: "setBotCopies", botId: "first", copies: 15 });
  await model.dispatch({ type: "setBotCopies", botId: "second", copies: 1 });

  // Then
  assert.equal(model.state.selectedBotIds.length, 16);
  assert.equal(model.state.canGenerate, false);
  assert.equal(model.minimumMapDimension("riverlands"), 25);
});

for (const copies of [-1, 1.5, NaN, 16]) {
  test(`the UI model rejects an invalid copy count of ${copies}`, async (context) => {
    // Given
    const { model } = createApplication(context, new CatalogGameClient());
    await model.dispatch({ type: "refreshBots", initial: true });

    // When
    await model.dispatch({ type: "setBotCopies", botId: "first", copies });

    // Then
    assert.deepEqual(model.state.selectedBotIds, ["first"]);
    assert.match(model.state.message, /copies/);
  });
}

test("bot selection displays accessible controls for each strategy's copy count", () => {
  // Given
  const catalog = createBotCatalog();

  // When
  const html = renderBotSelection(catalog.bots, ["scout", "scout"]);

  // Then
  assert.match(html, /aria-label="Copies of scout"/);
  assert.match(html, /value="2"/);
  assert.match(html, /max="15"/);
});

test("the CLI accepts repeated strategy IDs", async () => {
  // Given
  const argumentsList = ["play", "--bots", "nearest,nearest", "--ticks", "3", "--json"];

  // When
  const result = JSON.parse((await runCli(argumentsList)).stdout);

  // Then
  assert.deepEqual(result.botOrder, ["nearest-copy-1", "nearest-copy-2"]);
  assert.ok(result.standings.every((bot: { errors: number }) => bot.errors === 0));
});

test("the HTTP API accepts repeated strategies and records independent participants", async (context) => {
  // Given
  const fixture = await createHttpMatch(context, {
    botIds: ["nearest", "nearest"],
    config: CLASSIC_WORLD_RULES,
  });

  // When
  await finishHttpMatch(fixture);
  const replay = parseReplay(await downloadHttpReplay(fixture));

  // Then
  assert.equal(fixture.response.status, 201);
  assert.deepEqual(replay.result.botOrder, ["nearest-copy-1", "nearest-copy-2"]);
  assert.ok(replay.result.standings.every((bot) => bot.errors === 0));
});

test("removing a strategy preserves the other strategy's requested copies", async (context) => {
  // Given
  const { model } = createApplication(context, new CatalogGameClient());
  await model.dispatch({ type: "refreshBots", initial: true });
  await model.dispatch({ type: "setBotCopies", botId: "second", copies: 2 });

  // When
  await model.dispatch({ type: "setBotCopies", botId: "first", copies: 0 });

  // Then
  assert.deepEqual(model.state.selectedBotIds, ["second", "second"]);
  assert.equal(model.state.canGenerate, true);
});

test("copy requests cannot select an unavailable strategy", async (context) => {
  // Given
  const { model } = createApplication(context, new CatalogGameClient());
  await model.dispatch({ type: "refreshBots", initial: true });

  // When
  await model.dispatch({ type: "setBotCopies", botId: "missing", copies: 2 });

  // Then
  assert.deepEqual(model.state.selectedBotIds, ["first"]);
  assert.match(model.state.message, /available bot/);
});
