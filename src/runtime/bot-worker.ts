import { registerHooks } from "node:module";
import { parentPort } from "node:worker_threads";
import { randomFromSeed } from "../engine/random.ts";
import { copyObservationTerrain } from "../engine/observation-terrain.ts";
import type { Bot, BotConstructor, BotMetadata, GameMap, Observation } from "../engine/types.ts";
import type {
  CheckedBotSource,
  WorkerObservation,
  WorkerRequest,
  WorkerResponse,
} from "./worker-protocol.ts";

let bot: Bot | undefined;
let terrain: GameMap | undefined;
// Keep CLI stdout valid JSON when bots print debug information.
console.log = console.info = console.debug = (...values: unknown[]) => console.error(...values);
if (!parentPort) throw new Error("Bot worker must run in a worker thread");
const port = parentPort;
const respond = (message: WorkerResponse) => port.postMessage(message);

port.on("message", async (message: WorkerRequest) => {
  try {
    if (message.type === "init") await initializeBot(message);
    else if (message.type === "act") {
      const action = await bot!.act(restoreObservation(message.observation));
      respond({ type: "decision", action });
    }
  } catch (error) {
    respond({
      type: "error",
      error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
  }
});

function restoreObservation(observation: WorkerObservation): Observation {
  terrain = observation.map ?? terrain;
  if (!terrain) throw new Error("Missing bot terrain");

  return { ...observation, map: copyObservationTerrain(terrain) };
}

async function initializeBot(message: Extract<WorkerRequest, { type: "init" }>): Promise<void> {
  const random = randomFromSeed(message.seed);
  Math.random = random;
  const BotClass = await importCheckedBot(message.source);
  const { metadata } = message.source;
  if (typeof BotClass !== "function") throw new Error("Default-export a bot class");
  if (typeof BotClass.prototype?.act !== "function")
    throw new Error("Bot class needs an act(state) method");
  if (!metadataMatches(BotClass.metadata, metadata))
    throw new Error("Bot metadata changed during module initialization");

  bot = new BotClass({ random });
  if (typeof bot.act !== "function") throw new Error("Bot class needs an act(state) method");

  respond({ type: "ready", metadata });
}

function metadataMatches(actual: BotMetadata | undefined, expected: BotMetadata): boolean {
  if (!actual) return false;

  return (
    actual.id === expected.id &&
    actual.name === expected.name &&
    actual.description === expected.description
  );
}

async function importCheckedBot({ url, code }: CheckedBotSource): Promise<BotConstructor> {
  // Load the checked entry at its real URL so relative imports keep working.
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier !== url) return nextResolve(specifier, context);

      return { url, format: "module", shortCircuit: true };
    },
    load(moduleUrl, context, nextLoad) {
      if (moduleUrl !== url) return nextLoad(moduleUrl, context);

      return { format: "module", source: code, shortCircuit: true };
    },
  });

  try {
    return (await import(url)).default;
  } finally {
    hooks.deregister();
  }
}
