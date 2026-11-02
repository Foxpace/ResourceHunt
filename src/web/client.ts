import type { Replay } from "../engine/types.ts";
import type {
  BotCatalogResponse,
  CreateGameRequest,
  CreateGameResponse,
  StepGameResponse,
} from "../http/types.ts";

/** Playback can also use a local engine or a recorded source through this interface. */
export interface GameClient {
  create(request: CreateGameRequest): Promise<CreateGameResponse>;
  step(id: string): Promise<StepGameResponse>;
  replay(id: string): Promise<Replay>;
  release(id: string): Promise<void>;
}

export class HttpGameClient implements GameClient {
  constructor(private baseUrl = "") {}

  bots(): Promise<BotCatalogResponse> {
    return this.request("/api/bots");
  }

  create(request: CreateGameRequest): Promise<CreateGameResponse> {
    return this.request("/api/games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
  }

  step(id: string): Promise<StepGameResponse> {
    return this.request(`/api/games/${id}/step`, { method: "POST" });
  }

  replay(id: string): Promise<Replay> {
    return this.request(`/api/games/${id}/replay`);
  }

  async release(id: string): Promise<void> {
    await this.request(`/api/games/${id}`, { method: "DELETE", keepalive: true });
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, options);
    const body: unknown = await response.json();
    if (!response.ok) {
      const message =
        body && typeof body === "object" && "error" in body
          ? String(body.error)
          : `Request failed: ${response.status}`;
      throw new Error(message);
    }
    return body as T;
  }
}
