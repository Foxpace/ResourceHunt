import { parentPort } from "node:worker_threads";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.ts";
import { randomFromSeed } from "../engine/random.ts";
import type { Bot, BotConstructor } from "../engine/types.ts";

let bot: Bot | undefined;
// Keep CLI stdout valid JSON even when a bot prints debugging information.
console.log = console.info = console.debug = (...values: unknown[]) => console.error(...values);
if (!parentPort) throw new Error("Bot worker must run in a worker thread");
const port = parentPort;
const respond = (message: WorkerResponse) => port.postMessage(message);

port.on("message", async (message: WorkerRequest) => {
  try {
    if (message.type === "init") {
      const random = randomFromSeed(message.seed);
      Math.random = random;
      const module = await import(message.url);
      const BotClass = module.default as BotConstructor;
      const metadata = BotClass?.metadata;
      if (
        typeof BotClass !== "function" ||
        !metadata ||
        typeof metadata.id !== "string" ||
        !/^[a-z0-9][a-z0-9-]{0,47}$/.test(metadata.id) ||
        typeof metadata.name !== "string" ||
        !metadata.name.trim() ||
        metadata.name.length > 60 ||
        typeof metadata.description !== "string" ||
        metadata.description.length > 300
      )
        throw new Error(
          "Default-export a bot class with static metadata { id, name, description }. ID must use lowercase letters, numbers, and hyphens.",
        );
      if (!message.inspect) {
        bot = new BotClass({ random });
        if (typeof bot.act !== "function") throw new Error("Bot class needs an act(state) method");
      } else if (typeof BotClass.prototype.act !== "function")
        throw new Error("Bot class needs an act(state) method");
      respond({
        type: "ready",
        metadata: { id: metadata.id, name: metadata.name, description: metadata.description },
      });
    } else if (message.type === "act") {
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
