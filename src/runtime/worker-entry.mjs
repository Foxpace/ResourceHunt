import { register } from "tsx/esm/api";

// Register TypeScript inside the worker, including dynamically discovered bot classes.
register();
await import("./bot-worker.ts");
