import type { TestContext } from "node:test";
import type { Snapshot, Replay } from "../../src/engine/types.ts";
import { createGame } from "./game-fixtures.ts";

const BOT_COMPETITION_FIELDS = [
  "captures",
  "stolen",
  "lost",
  "stealReadyTick",
  "theftProtectedUntilTick",
] as const;
const CONFIG_COMPETITION_FIELDS = [
  "hotspotCount",
  "outpostCount",
  "stealing",
  "captureTurns",
  "stealCooldownTicks",
] as const;

export async function createLegacyCompetitionReplay(context: TestContext) {
  const game = createGame(context, {
    config: { ticks: 1, hotspotCount: 0, outpostCount: 0, stealing: false },
  });
  await game.step();
  const replay = JSON.parse(JSON.stringify(game.replay()));
  for (const frame of [replay.initial, ...replay.frames]) removeCompetitionState(frame);
  for (const field of CONFIG_COMPETITION_FIELDS) delete replay.initial.config[field];

  return replay;
}

function removeCompetitionState(frame: Partial<Snapshot>): void {
  delete frame.hotspots;
  delete frame.outposts;
  for (const bot of frame.bots ?? []) {
    for (const field of BOT_COMPETITION_FIELDS) delete (bot as Partial<typeof bot>)[field];
  }
}

export function removeLegacyDepotProtection(replay: Replay) {
  const legacy = JSON.parse(JSON.stringify(replay));
  delete legacy.initial.config.captureImmunityTicks;
  for (const frame of [legacy.initial, ...legacy.frames]) {
    for (const outpost of frame.outposts) delete outpost.captureProtectedUntilTick;
  }

  return legacy;
}
