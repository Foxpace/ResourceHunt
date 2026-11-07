import type { BotMetadata, GameConfig, MatchResult, Snapshot } from "../engine/types.ts";

export type { TournamentRound, TournamentRoundRequest } from "../competition/tournament.ts";

export interface BotCatalogResponse {
  bots: BotMetadata[];
  errors: { file: string; error: string }[];
  defaults: GameConfig;
  defaultBotIds: string[];
}

export interface CreateGameRequest {
  config: GameConfig;
  botIds: string[];
}

export interface CreateGameResponse {
  id: string;
  snapshot: Snapshot;
}

export interface StepGameResponse {
  snapshot: Snapshot;
  result?: MatchResult;
}
