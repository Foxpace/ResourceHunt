import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import type { BotController, BotMetadata, Decision, Observation } from "../engine/types.ts";
import type { BotDescriptor } from "./bots.ts";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.ts";

interface PendingWorkerRequest {
  resolveResponse(response: WorkerResponse): void;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

export class WorkerBot implements BotController {
  metadata: BotMetadata;
  private worker: Worker;
  private isWorkerStopped = false;
  private pendingWorkerRequest?: PendingWorkerRequest;
  constructor(
    private botDescriptor: BotDescriptor,
    private decisionTimeoutMs: number,
  ) {
    this.metadata = {
      id: botDescriptor.id,
      name: botDescriptor.name,
      description: botDescriptor.description,
    };
    this.worker = new Worker(new URL("./worker-entry.mjs", import.meta.url), {
      stdout: true,
      stderr: true,
    });
    this.attachWorkerListeners();
  }

  private attachWorkerListeners(): void {
    // Forward all bot output to stderr, including direct writes to process.stdout.
    this.worker.stdout.on("data", (chunk) => process.stderr.write(chunk));
    this.worker.stderr.on("data", (chunk) => process.stderr.write(chunk));
    this.worker.on("message", (response: WorkerResponse) => this.resolvePendingRequest(response));
    this.worker.on("error", (error) => this.stopWorkerWithError(error.message || "Worker failed"));
    this.worker.on("exit", (exitCode) => {
      if (this.isWorkerStopped) return;

      this.stopWorkerWithError(`Worker exited with code ${exitCode}`);
    });
  }

  private stopWorkerWithError(message: string): void {
    this.resolvePendingRequest({ type: "error", error: message, disabled: true });
    this.dispose();
  }

  private resolvePendingRequest(workerResponse: WorkerResponse) {
    if (!this.pendingWorkerRequest) return;

    clearTimeout(this.pendingWorkerRequest.timeoutTimer);
    const resolveRequest = this.pendingWorkerRequest.resolveResponse;
    this.pendingWorkerRequest = undefined;
    resolveRequest(workerResponse);
  }

  private sendWorkerRequest(
    workerRequest: WorkerRequest,
    timeoutMs: number,
  ): Promise<WorkerResponse> {
    return new Promise((resolveResponse) => {
      this.pendingWorkerRequest = {
        resolveResponse,
        timeoutTimer: setTimeout(() => {
          this.stopWorkerWithError(`Decision exceeded ${timeoutMs} ms; bot disabled`);
        }, timeoutMs),
      };
      try {
        this.worker.postMessage(workerRequest);
      } catch (error) {
        this.stopWorkerWithError(String(error));
      }
    });
  }

  async init(seed: string, inspect = false) {
    const workerResponse = await this.sendWorkerRequest(
      { type: "init", url: pathToFileURL(this.botDescriptor.file).href, seed, inspect },
      3000,
    );
    if (workerResponse.type !== "ready") {
      this.dispose();
      throw new Error(
        workerResponse.type === "error"
          ? workerResponse.error
          : "Unexpected worker response during initialization",
      );
    }

    this.assignInstanceMetadata(workerResponse.metadata, inspect);

    return this.metadata;
  }

  private assignInstanceMetadata(metadata: BotMetadata, inspect: boolean): void {
    if (inspect) {
      this.metadata = metadata;
      return;
    }

    const strategyId = this.botDescriptor.strategyId ?? this.botDescriptor.id;
    if (metadata.id !== strategyId)
      throw new Error("Bot metadata changed since discovery; refresh the bot list");

    this.metadata = {
      ...metadata,
      id: this.botDescriptor.id,
      name: this.botDescriptor.name,
      ...(this.botDescriptor.strategyId ? { strategyId } : {}),
    };
  }

  async decide(observation: Observation): Promise<Decision> {
    if (this.isWorkerStopped)
      return { action: null, error: "Bot worker is disabled", disabled: true };

    const workerResponse = await this.sendWorkerRequest(
      { type: "act", observation },
      this.decisionTimeoutMs,
    );
    if (workerResponse.type === "decision") return { action: workerResponse.action };
    if (workerResponse.type === "error")
      return { action: null, error: workerResponse.error, disabled: workerResponse.disabled };

    return { action: null, error: "Unexpected worker response during decision", disabled: true };
  }

  dispose() {
    if (this.isWorkerStopped) return;

    this.isWorkerStopped = true;
    this.resolvePendingRequest({ type: "error", error: "Bot worker stopped", disabled: true });
    void this.worker.terminate();
  }
}
