export function createMatchStatistics() {
  return {
    tilesWalked: 0,
    gathered: 0,
    deposits: 0,
    stolenValue: 0,
    sabotageAttempts: 0,
    sabotages: 0,
    depotOfflineTicks: 0,
    repairs: 0,
    trapsPlaced: 0,
    trapsTriggered: 0,
    trapsHit: 0,
    trapsCleared: 0,
    guardianStrikes: 0,
    guardiansDefeated: 0,
    guardianRepels: 0,
    cacheLooted: 0,
    droneStrikes: 0,
    droneStuns: 0,
  };
}

export type MatchStatistics = ReturnType<typeof createMatchStatistics>;
