import { createGame } from "../runtime/matches.ts";
import { BIOMES } from "../engine/biomes.ts";
import { createTournamentGame, recordTournamentScores } from "../runtime/tournament-round.ts";
import { normalizeConfig } from "../engine/config.ts";
import { DEFAULT_CONFIG, MAX_BOTS } from "../engine/types.ts";
import { discoverBots, selectBots, getDefaultBotIds } from "../runtime/bots.ts";
import type { Game } from "../engine/game.ts";

interface SessionRoute {
  method: string;
  id: string;
  action?: string;
}

interface GameSession {
  game: Game;
  touched: number;
  busy: boolean;
}
const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });

export function createGameApi() {
  return new GameApi();
}

class GameApi {
  private closed = false;
  private runningRound = false;
  private roundGame?: Game;
  private sessions = new Map<string, GameSession>();
  private cleanup: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanup = setInterval(() => this.removeExpiredSessions(), 60_000);
    this.cleanup.unref();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("origin");
    const crossOriginRequest = !!(origin && origin !== url.origin);
    if (crossOriginRequest) return json({ error: "Cross-origin requests are disabled" }, 403);

    try {
      return await this.routeRequest(request, url.pathname);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }

  dispose(): void {
    this.closed = true;
    clearInterval(this.cleanup);
    this.roundGame?.dispose();

    for (const session of this.sessions.values()) session.game.dispose();

    this.sessions.clear();
  }

  private removeExpiredSessions(): void {
    for (const [id, session] of this.sessions) {
      const sessionExpired = !session.busy && Date.now() - session.touched > 30 * 60_000;
      if (sessionExpired) this.deleteSession(id, session);
    }
  }

  private async routeRequest(request: Request, path: string): Promise<Response> {
    const catalogRequested = path === "/api/bots" && request.method === "GET";
    if (catalogRequested) return this.listBots();

    const creationRequested = path === "/api/games" && request.method === "POST";
    if (creationRequested) return this.createSession(request);

    const roundRequested = path === "/api/tournament/round" && request.method === "POST";
    if (roundRequested) return this.runTournamentRound(request);

    const match = /^\/api\/games\/([a-f0-9-]+)(?:\/(step|replay))?$/.exec(path);
    if (!match) return json({ error: "Not found" }, 404);

    const id = match[1]!;
    const session = this.sessions.get(id);
    if (!session) return json({ error: "Match expired. Create a new match." }, 404);

    session.touched = Date.now();

    return this.handleSessionRequest({ method: request.method, id, action: match[2] }, session);
  }

  private async runTournamentRound(request: Request): Promise<Response> {
    if (this.runningRound) return json({ error: "A tournament round is already running." }, 429);

    this.runningRound = true;
    try {
      this.roundGame = await this.createTournamentGame(request);
      if (this.closed) throw new Error("Game server is closed");
      return json(await recordTournamentScores(this.roundGame));
    } finally {
      this.roundGame?.dispose();
      this.roundGame = undefined;
      this.runningRound = false;
    }
  }

  private async createTournamentGame(request: Request): Promise<Game> {
    const body = (await request.json()) as {
      config?: unknown;
      botIds?: unknown;
      roundIndex?: unknown;
    };
    const config = parseUiConfig(body.config);
    if (!Array.isArray(body.botIds)) throw new Error(`Select 1 to ${MAX_BOTS} bot instances`);

    const bots = selectBots(await discoverBots(), body.botIds);
    const biomes = Object.keys(BIOMES) as (keyof typeof BIOMES)[];
    const roundIndex = body.roundIndex ?? biomes.indexOf(config.biome);
    if (typeof roundIndex !== "number") throw new Error("Invalid tournament round index");

    const integerIndex = Number.isSafeInteger(roundIndex);
    const nonnegativeIndex = roundIndex >= 0;
    const validIndex = integerIndex && nonnegativeIndex;
    if (!validIndex) throw new Error("Invalid tournament round index");
    return createTournamentGame(bots, config, roundIndex);
  }

  private async listBots(): Promise<Response> {
    const catalog = await discoverBots();

    return json({
      bots: catalog.bots.map(({ file, ...bot }) => bot),
      errors: catalog.errors,
      defaults: DEFAULT_CONFIG,
      defaultBotIds: getDefaultBotIds(catalog),
    });
  }

  private async createSession(request: Request): Promise<Response> {
    if (this.sessions.size >= 12)
      return json({ error: "Too many open matches. Reset or close another match." }, 429);

    const body = (await request.json()) as { config?: unknown; botIds?: unknown };
    const config = parseUiConfig(body.config);
    if (!Array.isArray(body.botIds)) throw new Error(`Select 1 to ${MAX_BOTS} bot instances`);

    const catalog = await discoverBots();
    const game = await createGame(selectBots(catalog, body.botIds), config);
    const id = crypto.randomUUID();
    this.sessions.set(id, { game, touched: Date.now(), busy: false });

    return json({ id, snapshot: game.snapshot() }, 201);
  }

  private async handleSessionRequest(route: SessionRoute, session: GameSession): Promise<Response> {
    const { method, id, action } = route;

    const deletionRequested = method === "DELETE" && !action;
    if (deletionRequested) {
      if (session.busy) return busySessionResponse();

      this.deleteSession(id, session);
      return json({ ok: true });
    }
    if (method === "GET") return this.readSession(session, action);

    const stepRequested = method === "POST" && action === "step";
    if (stepRequested) return this.stepSession(session);

    return json({ error: "Not found" }, 404);
  }

  private readSession(session: GameSession, action: string | undefined): Response {
    if (session.busy) return busySessionResponse();
    if (action === "replay") return json(session.game.replay());
    if (!action) return json({ snapshot: session.game.snapshot(), result: session.game.result() });

    return json({ error: "Not found" }, 404);
  }

  private async stepSession(session: GameSession): Promise<Response> {
    if (session.busy) return json({ error: "A tick is already in progress" }, 409);

    session.busy = true;
    try {
      const snapshot = await session.game.step();

      return json({ snapshot, result: snapshot.finished ? session.game.result() : undefined });
    } finally {
      session.busy = false;
    }
  }

  private deleteSession(id: string, session: GameSession): void {
    session.game.dispose();
    this.sessions.delete(id);
  }
}

function busySessionResponse(): Response {
  return json({ error: "Wait for the current tick to finish" }, 409);
}

function parseUiConfig(value: unknown) {
  const isPresent = !!value;
  const isObject = typeof value === "object";
  const isArray = Array.isArray(value);
  const invalidConfiguration = !isPresent || !isObject || isArray;
  if (invalidConfiguration) throw new Error("Game configuration is required");

  const config = normalizeConfig(value);
  if (config.width * config.height * config.ticks > 3_000_000)
    throw new Error(
      "UI replays support up to 3 million cells × ticks. Use the headless CLI for larger matches.",
    );

  return config;
}
