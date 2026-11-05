import type { Game } from "../../src/engine/game.ts";
import type { CreateGameRequest, CreateGameResponse } from "../../src/http/types.ts";
import type { GameClient } from "../../src/web/data/game-client.ts";
import { createLocalGame } from "./local-game-client.ts";
import { deferred, type Deferred } from "./deferred.ts";

interface PendingCreation {
  request: CreateGameRequest;
  response: Deferred<CreateGameResponse>;
}

/** Real engine sessions with manually controlled network completion order. */
export class ControlledGameClient implements GameClient {
  readonly steps: string[] = [];
  readonly releases: string[] = [];
  readonly stepStarted = deferred<void>();
  readonly exportStarted = deferred<void>();
  stepGate?: Deferred<void>;
  exportGate?: Deferred<void>;
  readonly releaseGates = new Map<string, Deferred<void>>();
  private games = new Map<string, Game>();
  private creations: PendingCreation[] = [];
  private creationSignals = new Map<number, Deferred<PendingCreation>>();

  create(request: CreateGameRequest): Promise<CreateGameResponse> {
    const creation = { request, response: deferred<CreateGameResponse>() };
    const index = this.creations.push(creation) - 1;
    this.creationSignals.get(index)?.resolve(creation);

    return creation.response.promise;
  }

  whenCreating(index: number): Promise<PendingCreation> {
    const creation = this.creations[index];
    if (creation) return Promise.resolve(creation);

    const signal = this.creationSignals.get(index) ?? deferred<PendingCreation>();
    this.creationSignals.set(index, signal);

    return signal.promise;
  }

  finishCreation(index: number): CreateGameResponse {
    const creation = this.creations[index]!;
    const game = createLocalGame(creation.request);
    const id = `session-${index}`;
    const response = { id, snapshot: game.snapshot() };
    this.games.set(id, game);
    creation.response.resolve(response);

    return response;
  }

  async step(id: string) {
    const game = this.getGameSession(id);
    this.steps.push(id);
    this.stepStarted.resolve();
    await this.stepGate?.promise;

    return { snapshot: await game.step() };
  }

  async replay(id: string) {
    const game = this.getGameSession(id);
    this.exportStarted.resolve();
    await this.exportGate?.promise;

    return game.replay();
  }

  async release(id: string): Promise<void> {
    this.releases.push(id);
    await this.releaseGates.get(id)?.promise;
    this.games.get(id)?.dispose();
    this.games.delete(id);
  }

  private getGameSession(id: string): Game {
    const game = this.games.get(id);
    if (!game) throw new Error(`Unknown test session: ${id}`);

    return game;
  }
}
