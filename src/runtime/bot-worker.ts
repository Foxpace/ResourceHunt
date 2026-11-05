import { parentPort } from "node:worker_threads";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.ts";
import { randomFromSeed } from "../engine/random.ts";
import type { Bot, BotConstructor } from "../engine/types.ts";

let bot: Bot | undefined;
// Keep CLI stdout valid JSON when bots print debug information.
console.log = console.info = console.debug = (...values: unknown[]) => console.error(...values);
if (!parentPort) throw new Error("Bot worker must run in a worker thread");
const port = parentPort;
const respond = (message: WorkerResponse) => port.postMessage(message);

port.on("message", async (message: WorkerRequest) => {
  try {
    if (message.type === "init") await initializeBot(message);
    else if (message.type === "act") {
      const action = await bot!.act(message.observation);
      respond({ type: "decision", action });
    }
  } catch (error) {
    respond({
      type: "error",
      error: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
    });
  }
});

async function initializeBot(message: Extract<WorkerRequest, { type: "init" }>): Promise<void> {
  const random = randomFromSeed(message.seed);
  Math.random = random;
  const module = await import(message.url);
  const BotClass = module.default as BotConstructor;
  const metadata = validateBotClass(BotClass);
  if (!message.inspect) {
    bot = new BotClass({ random });
    if (typeof bot.act !== "function") throw new Error("Bot class needs an act(state) method");
  } else if (typeof BotClass.prototype.act !== "function")
    throw new Error("Bot class needs an act(state) method");

  respond({
    type: "ready",
    metadata: { id: metadata.id, name: metadata.name, description: metadata.description },
  });
}

function validateBotClass(BotClass: BotConstructor) {
  const metadata = BotClass?.metadata;

  const hasClass = typeof BotClass === "function" && !!metadata;
  if (!hasClass) invalidBotClass();

  const idValid = typeof metadata.id === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(metadata.id);
  const nameValid = isValidBotName(metadata.name);
  const descriptionValid =
    typeof metadata.description === "string" && metadata.description.length <= 300;
  if (!idValid || !nameValid || !descriptionValid) invalidBotClass();

  return metadata;
}

function isValidBotName(name: unknown): boolean {
  if (typeof name !== "string") return false;

  const hasVisibleCharacters = name.trim().length > 0;
  const fitsLengthLimit = name.length <= 60;

  return hasVisibleCharacters && fitsLengthLimit;
}

function invalidBotClass(): never {
  throw new Error(
    "Default-export a bot class with static metadata { id, name, description }. ID must use lowercase letters, numbers, and hyphens.",
  );
}
