import type { TestContext } from "node:test";
import { discoverBots, type BotCatalog } from "../../src/runtime/bots.ts";
import { createGame } from "../../src/runtime/matches.ts";
import { normalizeConfig } from "../../src/engine/config.ts";
import { CLASSIC_WORLD_RULES } from "../../src/engine/world/types.ts";
import { createBotDirectory } from "./runtime-fixtures.ts";

const REPLICA_SOURCE = `
let decisions = 0;
export default class Replica {
  static metadata = { id: "replica", name: "Replica", description: "Checks isolated module state" };
  act(state) {
    decisions++;
    const direction = state.self.base.y < (state.map.height - 1) / 2 ? "S" : "N";
    if (decisions === 1) return { type: "move", direction };
    if (decisions === 2) return { type: "grab" };
    return { type: "home" };
  }
}`;

export function createReplicaConfig() {
  return normalizeConfig({
    ...CLASSIC_WORLD_RULES,
    width: 13,
    height: 13,
    ticks: 3,
    seed: "replicas",
  });
}

export async function createReplicaDescriptors(context: TestContext, count = 2) {
  const directory = await createBotDirectory(context, { "replica.ts": REPLICA_SOURCE });
  const catalog = await discoverBots(directory);

  return Array.from({ length: count }, () => catalog.bots[0]!);
}

export async function createReplicaGame(context: TestContext, count = 2) {
  const descriptors = await createReplicaDescriptors(context, count);
  const game = await createGame(descriptors, createReplicaConfig());
  context.after(() => game.dispose());

  return game;
}

export function createBotCatalog(ids = ["scout", "raider"]): BotCatalog {
  return {
    bots: ids.map((id) => ({ id, name: id, description: "Lineup fixture", file: `${id}.ts` })),
    errors: [],
  };
}
