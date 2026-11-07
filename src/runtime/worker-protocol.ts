import type { BotMetadata, GameMap, Observation } from "../engine/types.ts";

export type WorkerObservation = Omit<Observation, "map"> & { map?: GameMap };

export interface CheckedBotSource {
  url: string;
  code: string;
  metadata: BotMetadata;
}

export type WorkerRequest =
  | { type: "init"; source: CheckedBotSource; seed: string }
  | { type: "act"; observation: WorkerObservation };

export type WorkerResponse =
  | { type: "ready"; metadata: BotMetadata }
  | { type: "decision"; action: unknown }
  | { type: "error"; error: string; disabled?: boolean };
