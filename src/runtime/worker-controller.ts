import { Worker } from "node:worker_threads";
import type {
  BotController,
  BotMetadata,
  Decision,
  GameMap,
  Observation,
} from "../engine/types.ts";
import type { BotDescriptor } from "./bots.ts";
import { getObservationTerrain } from "../engine/observation-terrain.ts";
import type {
  CheckedBotSource,
  WorkerObservation,
  WorkerRequest,
  WorkerResponse,
} from "./worker-protocol.ts";

interface PendingWorkerRequest {
  resolveResponse(response: WorkerResponse): void;
  timeoutTimer: ReturnType<typeof setTimeout>;
}
const workerBusyMessage = "Bot worker already has a request in progress";

export class WorkerBot implements BotController {
  metadata: BotMetadata;
  private worker: Worker;
  private isWorkerStopped = false;
  private pendingWorkerRequest?: PendingWorkerRequest;
  private sentTerrain?: GameMap;
  constructor(
    private botDescriptor: BotDescriptor,
    private source: CheckedBotSource,
    private decisionTimeoutMs: number,
  ) {
    this.metadata = {
      id: botDescriptor.id,
      name: botDescriptor.name,
      description: botDescriptor.description,
    };
    this.worker = new Worker(new URL("./worker-entry.mjs", import.meta.url), {
      execArgv: [],
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

  async init(seed: string) {
    if (this.isWorkerStopped) throw new Error("Bot worker is disabled");
    if (this.pendingWorkerRequest) throw new Error(workerBusyMessage);

    const workerResponse = await this.sendWorkerRequest(
      { type: "init", source: this.source, seed },
      3000,
    );
    this.assignInstanceMetadata(this.readInitializationMetadata(workerResponse));

    return this.metadata;
  }

  private readInitializationMetadata(response: WorkerResponse): BotMetadata {
    if (response.type === "ready") return response.metadata;

    this.dispose();
    throw new Error(
      response.type === "error"
        ? response.error
        : "Unexpected worker response during initialization",
    );
  }

  private assignInstanceMetadata(metadata: BotMetadata): void {
    const { id, name, strategyId } = this.botDescriptor;
    this.metadata = {
      ...metadata,
      id,
      name,
      ...(strategyId ? { strategyId } : {}),
    };
  }

  async decide(observation: Observation): Promise<Decision> {
    if (this.isWorkerStopped)
      return { action: null, error: "Bot worker is disabled", disabled: true };
    if (this.pendingWorkerRequest) return { action: null, error: workerBusyMessage };

    const workerResponse = await this.sendWorkerRequest(
      { type: "act", observation: this.prepareObservation(observation) },
      this.decisionTimeoutMs,
    );

    return readDecisionResponse(workerResponse);
  }

  private prepareObservation(observation: Observation): WorkerObservation {
    const terrain = getObservationTerrain(observation.map);
    const workerHasTerrain = terrain && terrain === this.sentTerrain;
    this.sentTerrain = terrain;

    // A failed send disables the worker, so a later turn can only reuse a delivered map.
    return workerHasTerrain ? { ...observation, map: undefined } : observation;
  }

  dispose() {
    if (this.isWorkerStopped) return;

    this.isWorkerStopped = true;
    this.sentTerrain = undefined;
    this.resolvePendingRequest({ type: "error", error: "Bot worker stopped", disabled: true });
    void this.worker.terminate();
  }
}

function readDecisionResponse(response: WorkerResponse): Decision {
  if (response.type === "decision") return { action: response.action };
  if (response.type === "error")
    return { action: null, error: response.error, disabled: response.disabled };

  return { action: null, error: "Unexpected worker response during decision", disabled: true };
}
