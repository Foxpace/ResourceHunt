import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import type { BotController, BotMetadata, Decision, Observation } from "../engine/types.ts";
import type { BotDescriptor } from "./bots.ts";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.ts";

export class WorkerBot implements BotController {
  metadata: BotMetadata;
  private worker: Worker;
  private dead = false;
  private pending?: {
    resolve: (value: WorkerResponse) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  constructor(
    private descriptor: BotDescriptor,
    private timeout: number,
  ) {
    this.metadata = {
      id: descriptor.id,
      name: descriptor.name,
      description: descriptor.description,
    };
    this.worker = new Worker(new URL("./worker-entry.mjs", import.meta.url), {
      stdout: true,
      stderr: true,
    });
    // Forward all bot output to stderr, including direct writes to process.stdout.
    this.worker.stdout.on("data", (chunk) => process.stderr.write(chunk));
    this.worker.stderr.on("data", (chunk) => process.stderr.write(chunk));
    this.worker.on("message", (message: WorkerResponse) => this.finish(message));
    this.worker.on("error", (error) => {
      this.finish({ type: "error", error: error.message || "Worker failed", disabled: true });
      this.dispose();
    });
    this.worker.on("exit", (code) => {
      if (this.dead) return;
      this.finish({ type: "error", error: `Worker exited with code ${code}`, disabled: true });
      this.dispose();
    });
  }
  private finish(value: WorkerResponse) {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    const resolve = this.pending.resolve;
    this.pending = undefined;
    resolve(value);
  }
  private request(message: WorkerRequest, timeout: number): Promise<WorkerResponse> {
    return new Promise((resolve) => {
      this.pending = {
        resolve,
        timer: setTimeout(() => {
          this.finish({
            type: "error",
            error: `Decision exceeded ${timeout} ms; bot disabled`,
            disabled: true,
          });
          this.dispose();
        }, timeout),
      };
      try {
        this.worker.postMessage(message);
      } catch (error) {
        this.finish({ type: "error", error: String(error), disabled: true });
        this.dispose();
      }
    });
  }
  async init(seed: string, inspect = false) {
    const response = await this.request(
      { type: "init", url: pathToFileURL(this.descriptor.file).href, seed, inspect },
      3000,
    );
    if (response.type !== "ready") {
      this.dispose();
      throw new Error(
        response.type === "error"
          ? response.error
          : "Unexpected worker response during initialization",
      );
    }
    this.metadata = response.metadata;
    return this.metadata;
  }
  async decide(observation: Observation): Promise<Decision> {
    if (this.dead) return { action: null, error: "Bot worker is disabled", disabled: true };
    const response = await this.request({ type: "act", observation }, this.timeout);
    if (response.type === "decision") return { action: response.action };
    if (response.type === "error")
      return { action: null, error: response.error, disabled: response.disabled };
    return { action: null, error: "Unexpected worker response during decision", disabled: true };
  }
  dispose() {
    if (this.dead) return;
    this.dead = true;
    this.finish({ type: "error", error: "Bot worker stopped", disabled: true });
    void this.worker.terminate();
  }
}
