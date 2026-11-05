export { Game } from "./engine/game.ts";
export { normalizeConfig } from "./engine/config.ts";
export { generateMap } from "./engine/map.ts";
export { randomFromSeed } from "./engine/random.ts";
export { parseReplay } from "./engine/replay.ts";
export { discoverBots, createControllers } from "./runtime/bots.ts";
export { createGame, runToEnd } from "./runtime/matches.ts";
export { runBenchmark } from "./runtime/benchmark.ts";
export type { MatchStatistics } from "./engine/match-statistics.ts";
export type { BenchmarkOptions, BenchmarkResult, BenchmarkStanding } from "./runtime/benchmark.ts";
export * from "./sdk.ts";
export { DEFAULT_CONFIG } from "./engine/types.ts";
export type {
  BotController,
  Decision,
  Frame,
  GameConfig,
  MatchResult,
  Replay,
  Snapshot,
} from "./engine/types.ts";

export { createBotLineup } from "./runtime/lineup.ts";
export type { BotDescriptor } from "./runtime/bots.ts";
