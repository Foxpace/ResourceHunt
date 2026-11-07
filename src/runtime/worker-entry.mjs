import { register } from "tsx/esm/api";

// Register TypeScript for the worker and the bot's imported helpers.
register();
await import("./bot-worker.ts");
