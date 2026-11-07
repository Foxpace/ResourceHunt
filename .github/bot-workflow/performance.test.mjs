import assert from "node:assert/strict";
import { test } from "node:test";
import {
  describeTournament,
  summarizePerformance,
  summarizeTournamentRuns,
} from "./performance.mjs";

function standing(id, score, rank) {
  return {
    id,
    score,
    rank,
    delivered: 0,
    errors: 0,
    disabled: false,
    captures: 0,
    stolen: 0,
    lost: 0,
    carriedValue: 0,
    outpostsOwned: 0,
    statistics: { deposits: 1, tilesWalked: 2 },
  };
}

function round(teamScore, rivalScore) {
  const botOrder = ["rival", "team"];
  const standings = [
    standing("team", teamScore, teamScore >= rivalScore ? 1 : 2),
    standing("rival", rivalScore, rivalScore >= teamScore ? 1 : 2),
  ];
  const scores = [
    [0, 0],
    [0, teamScore],
    [rivalScore, teamScore],
  ];

  return {
    result: { botOrder, standings, ticks: 2, config: { biome: "forest", seed: "demo" } },
    scores,
  };
}

function sharedTournament() {
  return {
    options: { winTarget: 2 },
    rounds: [round(10, 3), round(6, 7), round(4, 4)],
    standings: [
      { id: "team", wins: 2, score: 20, errors: 0 },
      { id: "rival", wins: 2, score: 14, errors: 0 },
    ],
  };
}

test("benchmark optimization stats use the participant's column in each match", () => {
  // Given
  const { result, scores } = round(8, 5);

  // When
  const stats = summarizePerformance([{ ...result, scores }], {
    id: "team",
    participants: { team: "team", rival: "rival" },
  });

  // Then
  assert.equal(stats.meanFirstBankTick, 1);
  assert.equal(stats.meanHalfwayScore, 8);
  assert.equal(stats.pointsPerDeposit, 8);
  assert.equal(stats.pointsPerTile, 4);
});

test("a shared tournament champion is credited even when second by points", () => {
  // Given
  const data = sharedTournament();

  // When
  const run = describeTournament(data, ["rival", "team"]);
  const summary = summarizeTournamentRuns([{ ...run, data }]);

  // Then
  assert.equal(run.team.place, 2);
  assert.equal(summary.wins, 1);
  assert.equal(summary.sharedWins, 1);
  assert.equal(summary.sharedRoundWins, 1);
});

test("tournament progression counts points and shared firsts by participant", () => {
  // Given
  const data = sharedTournament();

  // When
  const { progression } = describeTournament(data, ["rival", "team"]);
  const last = progression.at(-1);

  // Then
  assert.deepEqual(last.leaders, ["team", "rival"]);
  assert.deepEqual(
    last.standings.map(({ cumulativeScore, cumulativeWins }) => [cumulativeScore, cumulativeWins]),
    [
      [20, 2],
      [14, 2],
    ],
  );
});
