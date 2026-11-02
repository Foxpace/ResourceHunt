import type { BotMetadata, Observation } from "../engine/types.ts";

export type WorkerRequest =
  | { type: "init"; url: string; seed: string; inspect: boolean }
  | { type: "act"; observation: Observation };

export type WorkerResponse =
  | { type: "ready"; metadata: BotMetadata }
  | { type: "decision"; action: unknown }
  | { type: "error"; error: string; disabled?: boolean };
