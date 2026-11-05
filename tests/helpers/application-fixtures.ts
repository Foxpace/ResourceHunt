import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { ApplicationModel, type ReplayFile } from "../../src/web/model/application.ts";
import { DEFAULT_CONFIG, type Replay } from "../../src/engine/types.ts";
import type { BotCatalogResponse, CreateGameRequest } from "../../src/http/types.ts";
import type { GameClient } from "../../src/web/data/game-client.ts";
import { ControlledGameClient } from "./controlled-game-client.ts";
import { LocalGameClient } from "./local-game-client.ts";
import { createMatchRequest } from "./game-fixtures.ts";
import { createRecordedReplay } from "./playback-fixtures.ts";
import { deferred } from "./deferred.ts";

export function createCatalog(): BotCatalogResponse {
  return {
    bots: ["first", "second"].map((id) => ({ id, name: id, description: "Test bot" })),
    errors: [],
    defaults: DEFAULT_CONFIG,
    defaultBotIds: ["first"],
  };
}

export class CatalogGameClient extends LocalGameClient {
  catalog = createCatalog();
  async bots() {
    return structuredClone(this.catalog);
  }
}

export class PendingCatalogGameClient extends ControlledGameClient {
  creationRequests = 0;
  async bots() {
    return createCatalog();
  }
  override create(request: CreateGameRequest) {
    this.creationRequests++;

    return super.create(request);
  }
}

export function createApplication<
  Client extends GameClient & { bots(): Promise<BotCatalogResponse> },
>(context: TestContext, client: Client) {
  const model = new ApplicationModel(client);
  context.after(() => model.dispose());

  return { client, model };
}

export async function createLiveApplication(context: TestContext) {
  const fixture = createApplication(context, new CatalogGameClient());
  await fixture.model.dispatch({ type: "generateMatch", request: createMatchRequest() });
  await fixture.model.dispatch({ type: "stepPlayback" });

  return fixture;
}

export function createReplayFile(replay: unknown): ReplayFile {
  return { size: 1, text: async () => JSON.stringify(replay) };
}

export function createPendingReplayFile() {
  const read = deferred<string>();

  return { read, file: { size: 1, text: () => read.promise } };
}

export async function captureExport(model: ApplicationModel): Promise<Replay> {
  let exported!: Replay;
  await model.dispatch({
    type: "exportReplay",
    saveReplay: (replay) => {
      exported = replay;
    },
  });

  return exported;
}

export class ControlledApplicationFixture {
  readonly client = new PendingCatalogGameClient();
  readonly model: ApplicationModel;
  private nextCreationIndex = 0;

  constructor(context: TestContext) {
    this.model = createApplication(context, this.client).model;
  }

  async beginGeneration(seed = "test") {
    const index = this.nextCreationIndex++;
    const completion = this.model.dispatch({
      type: "generateMatch",
      request: createMatchRequest(seed),
    });
    const pending = await this.client.whenCreating(index);

    return {
      completion,
      pending,
      finish: async () => {
        this.client.finishCreation(index);
        await completion;
      },
    };
  }

  async importReplay(seed: string): Promise<void> {
    await this.model.dispatch({
      type: "importReplay",
      file: createReplayFile(await createRecordedReplay(seed)),
    });
  }
}

export async function createSupersededGeneration(context: TestContext) {
  const fixture = new ControlledApplicationFixture(context);
  const older = await fixture.beginGeneration("older");
  await fixture.importReplay("imported");

  return { fixture, older };
}

export function assertApplicationDisposed(model: ApplicationModel): void {
  assert.partialDeepStrictEqual(model.state, {
    selectedBotIds: [],
    message: "",
    canGenerate: false,
  });
  assert.partialDeepStrictEqual(model.playbackControls, {
    canPlay: false,
    canStep: false,
    canExport: false,
    canSeek: false,
  });
}

export class DisposeAfterReplayClient extends CatalogGameClient {
  onReplay?: () => void;
  override replay(): Promise<Replay> {
    const response = super.replay();
    void response.then(() => queueMicrotask(() => this.onReplay?.()));

    return response;
  }
}

export function createDisposingExport(context: TestContext) {
  const { client, model } = createApplication(context, new DisposeAfterReplayClient());
  const activity = { saves: 0, disposal: undefined as Promise<void> | undefined };
  client.onReplay = () => {
    activity.disposal = model.dispose();
  };
  const saveReplay = () => {
    activity.saves++;
  };

  return { client, model, activity, saveReplay };
}
