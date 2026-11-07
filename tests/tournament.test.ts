import assert from "node:assert/strict";
import { once } from "node:events";
import { test, type TestContext } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { BroadcastChannel } from "node:worker_threads";
import { createMatchStatistics } from "../src/engine/match-statistics.ts";
import { DEFAULT_CONFIG, type Standing } from "../src/engine/types.ts";
import { createGameApi } from "../src/http/game-api.ts";
import type { TournamentRound } from "../src/http/types.ts";
import {
  summarizeTournament,
  Tournament,
  tournamentBiomes,
} from "../src/competition/tournament.ts";
import { defaultBadgeOptions, selectAwards } from "../src/competition/awards.ts";
import { renderResults } from "../src/web/view/results.ts";
import { HttpGameClient } from "../src/web/data/game-client.ts";
import { startServer } from "../src/server.ts";
import { discoverBots, selectBots } from "../src/runtime/bots.ts";
import { runTournamentRound } from "../src/runtime/tournament-round.ts";
import { deferred } from "./helpers/deferred.ts";
import { createBotDirectory } from "./helpers/runtime-fixtures.ts";

test("tournament wins outrank points in totals, podium, and standings", () => {
  // Given
  const rounds = rankingRounds();
  // When
  const totals = summarizeTournament(rounds);
  const html = renderResults(totals, "ranking", { mode: "tournament" });
  // Then
  assert.deepEqual(
    totals.map(({ name }) => name),
    ["Winner", "Points"],
  );
  assert.equal(totals[0]!.wins, 2);
  assert.ok(totals[0]!.score < totals[1]!.score);
  assert.ok(html.indexOf("<strong>Winner</strong>") < html.indexOf("<strong>Points</strong>"));
  assert.ok(html.indexOf('scope="row">Winner') < html.indexOf('scope="row">Points'));
});

test("equal tournament wins are ranked by points", () => {
  // Given
  const rounds = rankingRounds().slice(0, 2);
  // When
  const totals = summarizeTournament(rounds);
  // Then
  assert.deepEqual(
    totals.map(({ name }) => name),
    ["Points", "Winner"],
  );
});

test("individual match results still rank by points", () => {
  // Given
  const totals = summarizeTournament(rankingRounds());
  // When
  const html = renderResults(totals, "ranking", { mode: "match" });
  // Then
  assert.ok(html.indexOf("<strong>Points</strong>") < html.indexOf("<strong>Winner</strong>"));
});

function rankingRounds(): TournamentRound[] {
  return [
    [2, 1],
    [0, 100],
    [2, 1],
  ].map((scores) => ({
    scores: [scores],
    result: {
      config: DEFAULT_CONFIG,
      ticks: 0,
      resourceUnitsLeft: 0,
      botOrder: ["Winner", "Points"],
      standings: scores.map((score, index) => rankingStanding({ score, index, scores })),
    },
  }));
}

function rankingStanding(input: { score: number; index: number; scores: number[] }): Standing {
  const name = input.index === 0 ? "Winner" : "Points";
  return {
    id: name,
    name,
    rank: input.score === Math.max(...input.scores) ? 1 : 2,
    score: input.score,
    delivered: 0,
    carriedValue: 0,
    errors: 0,
    disabled: false,
    captures: 0,
    outpostsOwned: 0,
    stolen: 0,
    lost: 0,
  };
}

test("stopping a tournament keeps completed rounds and ignores a late result", async () => {
  // Given
  const completed = rankingRounds()[0]!;
  const pending = deferred<TournamentRound>();
  const tournament = new Tournament({
    tournamentRound: async ({ roundIndex }) => (roundIndex === 0 ? completed : pending.promise),
  });
  const running = tournament.run(tournamentRequest(1), tournamentOptions, () => {});
  await Promise.resolve();

  // When
  tournament.stop();
  pending.resolve(completed);
  await running;

  // Then
  assert.deepEqual(tournament.rounds, [completed]);
  assert.equal(tournament.stopped, true);
});

test("the round runner cancels a game still starting", async () => {
  // Given
  const bots = selectBots(await discoverBots(), ["nearest"]);
  const abort = new AbortController();
  const reason = new Error("Canceled while starting");

  // When
  const round = runTournamentRound(bots, tournamentRequest(1), abort.signal);
  abort.abort(reason);

  // Then
  await assert.rejects(round, (error) => error === reason);
});

test("the round runner cancels an in-flight bot decision", { timeout: 10000 }, async (context) => {
  // Given
  const { bots, started } = await createBlockedRound(context);
  const abort = new AbortController();
  context.after(() => abort.abort());
  const round = tournamentRequest(1);
  round.config.decisionTimeoutMs = 5000;
  const reason = new Error("Canceled during a decision");

  // When
  const running = runTournamentRound(bots, round, abort.signal);
  await Promise.race([started, running]);
  abort.abort(reason);

  // Then
  const canceled = Promise.race([running, delay(2000, undefined, { ref: false })]);
  await assert.rejects(canceled, (error) => error === reason);
});

async function createBlockedRound(context: TestContext) {
  const channelName = crypto.randomUUID();
  const channel = new BroadcastChannel(channelName);
  context.after(() => channel.close());
  const started = once(channel, "message");
  const directory = await createBotDirectory(context, {
    "blocked.ts": `
      import { BroadcastChannel } from "node:worker_threads";
      export default class {
        static metadata = { id: "blocked", name: "Blocked", description: "Test" };
        act() {
          const channel = new BroadcastChannel(${JSON.stringify(channelName)});
          channel.postMessage("started");
          while (true) {}
        }
      }
    `,
  });

  const { bots } = await discoverBots(directory);
  return { bots, started };
}

test("canceling an HTTP round frees the tournament slot for the next request", async (context) => {
  // Given
  const app = await startServer(0);
  context.after(() => app.dispose());
  const client = new HttpGameClient(`http://127.0.0.1:${app.port}`);
  const controller = new AbortController();
  const arrived = once(app.server, "request");
  const active = client.tournamentRound(tournamentRequest(1000), controller.signal);
  const canceled = assert.rejects(active, { name: "AbortError" });
  await arrived;
  await assert.rejects(requestShortRound(client), /already running/);

  // When
  controller.abort();
  await canceled;
  const next = await requestShortRound(client);

  // Then
  assert.equal(next.result.ticks, 1);
});

function requestShortRound(client: HttpGameClient): Promise<TournamentRound> {
  return client.tournamentRound(tournamentRequest(1), new AbortController().signal);
}

const tournamentOptions = { winTarget: 3, badges: defaultBadgeOptions };

function tournamentRequest(ticks: number) {
  return { config: { ...DEFAULT_CONFIG, ticks }, botIds: ["nearest", "nearest"], roundIndex: 0 };
}

test("a tournament stops at the win target and keeps score history for each replica", async (context) => {
  // Given
  const api = createGameApi();
  context.after(() => api.dispose());
  const tournament = createTestTournament(api);

  // When
  await tournament.run(
    { config: { ...DEFAULT_CONFIG, ticks: 24 }, botIds: ["nearest", "nearest"] },
    { winTarget: 3, badges: defaultBadgeOptions },
    () => {},
  );

  // Then
  assertTournament(tournament);
});

test("shared wins count toward the target and repeated biomes keep separate rounds", async (context) => {
  // Given
  const api = createGameApi();
  context.after(() => api.dispose());
  const tournament = createTestTournament(api);

  // When
  await tournament.run(
    { config: { ...DEFAULT_CONFIG, ticks: 1 }, botIds: ["nearest", "nearest"] },
    { winTarget: 9, badges: defaultBadgeOptions },
    () => {},
  );
  // Then
  assert.deepEqual([tournament.rounds.length, tournament.winners.length], [9, 2]);
  assert.equal(tournament.rounds[8]!.result.config.biome, tournamentBiomes[0]);
  assert.notEqual(
    tournament.rounds[8]!.result.config.seed,
    tournament.rounds[0]!.result.config.seed,
  );
});

function createTestTournament(api: ReturnType<typeof createGameApi>): Tournament {
  return new Tournament({
    async tournamentRound(request) {
      const response = await api.fetch(
        new Request("http://localhost/api/tournament/round", {
          method: "POST",
          body: JSON.stringify(request),
        }),
      );
      assert.equal(response.status, 200);
      return (await response.json()) as TournamentRound;
    },
  });
}

function assertTournament(tournament: Tournament): void {
  assert.equal(tournament.error, "");
  const biomes = tournament.rounds.map(({ result }) => result.config.biome);
  assert.deepEqual(biomes, tournamentBiomes.slice(0, biomes.length));
  assert.ok(tournament.winners.length > 0);
  const totals = summarizeTournament(tournament.rounds);
  assert.equal(totals.length, 2);
  assert.equal(Math.max(...totals.map((row) => row.wins)), 3);
  for (const { result, scores } of tournament.rounds) {
    assert.equal(scores.length, 25);
    assert.deepEqual(scores[0], [0, 0]);
    const final = result.botOrder.map((id) => result.standings.find((row) => row.id === id)!.score);
    assert.deepEqual(scores.at(-1), final);
  }
  for (const row of totals) {
    const scores = tournament.rounds.map(
      ({ result }) => result.standings.find((standing) => standing.id === row.id)!.score,
    );
    assert.equal(
      row.score,
      scores.reduce((sum, score) => sum + score, 0),
    );
    assert.ok(row.statistics!.tilesWalked > 0);
    assert.ok(row.badges > 0);
  }
}

test("results pick three standout awards and five distinct random awards", () => {
  // Given
  const rows = awardRows();

  // When
  const awards = selectAwards(rows, "test-match");

  // Then
  assert.equal(awards.prominent.length, 3);
  assert.equal(awards.extras.length, 5);
  assert.equal(
    new Set([...awards.prominent, ...awards.extras].map((award) => award.title)).size,
    8,
  );
  assert.deepEqual(awards, selectAwards(rows, "test-match"));
  assert.notDeepEqual(awards.extras, selectAwards(rows, "another-match").extras);
});

function awardRows() {
  const earned = Object.fromEntries(Object.keys(createMatchStatistics()).map((key) => [key, 1]));
  return [
    {
      id: "scout",
      name: "Scout",
      score: 20,
      delivered: 5,
      stolen: 1,
      lost: 1,
      captures: 1,
      statistics: earned,
    },
  ];
}
