import { Game } from "../../src/engine/game.ts";
import type { Replay } from "../../src/engine/types.ts";
import type { CreateGameRequest } from "../../src/http/types.ts";
import type { GameClient } from "../../src/web/data/game-client.ts";

/** Run playback against the real engine without requiring a browser or HTTP server. */
export class LocalGameClient implements GameClient {
  game?: Game;
  steps = 0;
  releases = 0;

  async create(request: CreateGameRequest) {
    this.game = createLocalGame(request);
    return { id: "local", snapshot: this.game.snapshot() };
  }
  async step() {
    this.steps++;
    return { snapshot: await this.game!.step() };
  }
  async replay() {
    return this.game!.replay();
  }
  async release() {
    this.releases++;
    this.game!.dispose();
  }
}

export function createLocalGame(request: CreateGameRequest): Game {
  return new Game(
    request.botIds.map((id) => ({
      metadata: { id, name: id, description: "Playback test" },
      async decide() {
        return { action: { type: "skip" } };
      },
      dispose() {},
    })),
    request.config,
  );
}

export async function recordLocalReplay(request: CreateGameRequest, frames = 2): Promise<Replay> {
  const client = new LocalGameClient();
  try {
    await client.create(request);
    for (let frame = 0; frame < frames; frame++) await client.step();

    return await client.replay();
  } finally {
    await client.release();
  }
}
