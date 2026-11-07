export function participantStrategies(order, lineup) {
  // The first match uses the requested order, before the engine rotates starting bases.
  return Object.fromEntries(order.map((id, index) => [id, lineup[index]]));
}

export function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

export function sum(rows, key) {
  return rows.reduce((total, row) => total + row[key], 0);
}

export function summarizePerformance(matches, strategy) {
  const trials = matches.map((match) => strategyMatch(match, strategy));
  const starts = trials.flatMap((trial) => trial.starts);
  const rows = starts.map((start) => start.row);

  return {
    id: strategy.id,
    matches: matches.length,
    starts: starts.length,
    ...scoreSummary(rows),
    ...winSummary(trials),
    ...activitySummary(rows),
    ...historySummary(starts),
  };
}

function strategyMatch(match, strategy) {
  const { id, participants } = strategy;
  const own = match.standings.filter((row) => participants[row.id] === id);
  const rivals = match.standings.filter((row) => participants[row.id] !== id);
  const firsts = match.standings.filter((row) => row.rank === 1);
  const placedFirst = own.some((row) => row.rank === 1);
  const rivalScore = Math.max(...rivals.map((row) => row.score));

  return {
    starts: own.map((row) => ({ row, history: scoreHistory(match, row.id) })),
    won: placedFirst && firsts.length === 1,
    tied: placedFirst && firsts.length > 1,
    margin: rivals.length ? mean(own.map((row) => row.score)) - rivalScore : null,
  };
}

function scoreSummary(rows) {
  const scores = rows.map((row) => row.score).sort((first, second) => first - second);
  const meanScore = mean(scores);
  const lowerMiddle = scores[Math.floor((scores.length - 1) / 2)];
  const upperMiddle = scores[Math.floor(scores.length / 2)];
  const variance = mean(scores.map((score) => (score - meanScore) ** 2));

  return {
    totalScore: sum(rows, "score"),
    meanScore,
    medianScore: (lowerMiddle + upperMiddle) / 2,
    minScore: scores[0],
    maxScore: scores.at(-1),
    scoreStdDev: Math.sqrt(variance),
    meanRank: mean(rows.map((row) => row.rank)),
    scorelessStarts: scores.filter((score) => score === 0).length,
  };
}

function winSummary(trials) {
  const wins = trials.filter((trial) => trial.won).length;
  const ties = trials.filter((trial) => trial.tied).length;
  const margins = trials.map((trial) => trial.margin).filter((margin) => margin !== null);

  return {
    wins,
    ties,
    losses: trials.length - wins - ties,
    firstPlaceRate: (wins + ties) / trials.length,
    meanMargin: mean(margins),
  };
}

function activitySummary(rows) {
  const statistics = sumStatistics(rows);
  const score = sum(rows, "score");

  return {
    errors: sum(rows, "errors"),
    disabledStarts: rows.filter((row) => row.disabled).length,
    delivered: sum(rows, "delivered"),
    captures: sum(rows, "captures"),
    stolen: sum(rows, "stolen"),
    lost: sum(rows, "lost"),
    meanOutpostsOwned: mean(rows.map((row) => row.outpostsOwned)),
    meanUnbanked: mean(rows.map((row) => row.carriedValue)),
    pointsPerDeposit: statistics.deposits ? score / statistics.deposits : null,
    pointsPerTile: statistics.tilesWalked ? score / statistics.tilesWalked : null,
    statistics,
  };
}

function sumStatistics(rows) {
  const totals = new Map();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row.statistics ?? {}))
      totals.set(key, (totals.get(key) ?? 0) + value);
  }

  return Object.fromEntries(totals);
}

function scoreHistory(match, id) {
  if (!match.scores) return null;
  const slot = match.botOrder.indexOf(id);
  const first = match.scores.findIndex((points) => points[slot] > 0);
  const halfway = Math.floor(match.ticks / 2);

  return { firstBankTick: first < 0 ? null : first, halfwayScore: match.scores[halfway][slot] };
}

function historySummary(starts) {
  const histories = starts.map((start) => start.history).filter(Boolean);
  const firstBanks = histories.map((row) => row.firstBankTick).filter((tick) => tick !== null);

  return {
    meanFirstBankTick: mean(firstBanks),
    meanHalfwayScore: mean(histories.map((row) => row.halfwayScore)),
  };
}

function tournamentProgress(rounds) {
  const totals = new Map();
  return rounds.map(({ result }, index) => ({
    round: index + 1,
    biome: result.config.biome,
    seed: result.config.seed,
    leaders: result.standings.filter((row) => row.rank === 1).map((row) => row.id),
    standings: result.standings.map((row) => addTournamentRound(totals, row)),
  }));
}

export function describeTournament(data, lineup) {
  const { botOrder } = data.rounds[0].result;
  const participants = participantStrategies(botOrder, lineup);
  const identities = participantStrategies(botOrder, botOrder);
  const rounds = data.rounds.map(({ result, scores }) => ({ ...result, scores }));
  const standings = data.standings.map((row) => ({
    ...row,
    place: data.standings.findIndex((other) => sameTournamentRecord(row, other)) + 1,
  }));
  const team = standings.find((row) => row.id === botOrder[0]);
  if (!team) throw new Error(`${lineup[0]} is missing from the standings.`);
  const winners = standings.filter((row) => row.wins >= data.options.winTarget);

  return {
    participants,
    standings,
    team,
    winnerIds: winners.map((row) => row.id),
    progression: tournamentProgress(data.rounds),
    performance: standings.map(({ id }) =>
      summarizePerformance(rounds, { id, participants: identities }),
    ),
  };
}

function sameTournamentRecord(row, other) {
  const sameWins = row.wins === other.wins;
  const samePoints = row.score === other.score;

  return sameWins && samePoints;
}

export function summarizeTournamentRuns(runs) {
  const completed = runs.filter((run) => run.data);
  const won = completed.filter((run) => run.winnerIds.includes(run.team.id));
  const rounds = completed.reduce((total, run) => total + run.progression.length, 0);
  const teams = completed.map((run) => run.team);
  const teamMetrics = completed.map((run) => run.performance.find((row) => row.id === run.team.id));
  const totalScore = sum(teams, "score");

  return {
    attempted: runs.length,
    completed: completed.length,
    wins: won.length,
    sharedWins: won.filter((run) => run.winnerIds.length > 1).length,
    rounds,
    roundWins: sum(teams, "wins"),
    sharedRoundWins: sum(teamMetrics, "ties"),
    totalScore,
    meanRoundScore: rounds ? totalScore / rounds : null,
    meanPlace: mean(teams.map((team) => team.place)),
    errors: sum(teams, "errors"),
  };
}

function addTournamentRound(totals, row) {
  const { id, rank, score, errors } = row;
  const prior = totals.get(id) ?? { cumulativeScore: 0, cumulativeWins: 0 };
  const round = {
    id,
    rank,
    score,
    errors,
    cumulativeScore: prior.cumulativeScore + score,
    cumulativeWins: prior.cumulativeWins + Number(rank === 1),
  };
  totals.set(id, round);

  return round;
}
