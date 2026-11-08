import { createGame } from "../runtime/matches.ts";
import { tournamentBiomes } from "../competition/tournament.ts";
import { runTournamentRound } from "../runtime/tournament-round.ts";
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
const MAX_OPEN_MATCHES = 12;

export function createGameApi() {
  return new GameApi();
}

class GameApi {
  private closed = false;
  private activeRound?: AbortController;
  private sessions = new Map<string, GameSession>();
  private openingSessions = 0;
  private cleanup: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanup = setInterval(() => this.removeExpiredSessions(), 60_000);
    this.cleanup.unref();
  }

  async fetch(request: Request): Promise<Response> {
    if (this.closed) return closedServerResponse();

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
    this.activeRound?.abort();

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
    if (roundRequested) return this.handleTournamentRound(request);

    return this.routeSessionRequest(request, path);
  }

  private routeSessionRequest(request: Request, path: string): Promise<Response> | Response {
    const match = /^\/api\/games\/([a-f0-9-]+)(?:\/(step|replay))?$/.exec(path);
    if (!match) return json({ error: "Not found" }, 404);

    const id = match[1]!;
    const session = this.sessions.get(id);
    if (!session) return json({ error: "Match expired. Create a new match." }, 404);

    session.touched = Date.now();

    return this.handleSessionRequest({ method: request.method, id, action: match[2] }, session);
  }

  private async handleTournamentRound(request: Request): Promise<Response> {
    if (this.activeRound) return json({ error: "A tournament round is already running." }, 429);
    const round = new AbortController();
    const signal = AbortSignal.any([request.signal, round.signal]);
    const release = () => {
      if (this.activeRound === round) this.activeRound = undefined;
    };
    this.activeRound = round;
    signal.addEventListener("abort", release, { once: true });

    try {
      signal.throwIfAborted();
      const { bots, config, roundIndex } = await readTournamentRound(request, signal);
      const scores = await runTournamentRound(bots, { config, roundIndex }, signal);
      signal.throwIfAborted();
      return json(scores);
    } catch (error) {
      if (round.signal.aborted) return closedServerResponse();

      throw error;
    } finally {
      signal.removeEventListener("abort", release);
      release();
    }
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
    if (this.sessions.size + this.openingSessions >= MAX_OPEN_MATCHES)
      return json({ error: "Too many open matches. Reset or close another match." }, 429);

    this.openingSessions++;
    try {
      const { config, botIds } = await readMatchRequest(request);
      if (this.closed) return closedServerResponse();

      const catalog = await discoverBots();
      if (this.closed) return closedServerResponse();

      const game = await createGame(selectBots(catalog, botIds), config);
      return this.publishSession(game);
    } finally {
      this.openingSessions--;
    }
  }

  private publishSession(game: Game): Response {
    if (this.closed) {
      game.dispose();
      return closedServerResponse();
    }

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

function closedServerResponse(): Response {
  return json({ error: "Game server is closed" }, 503);
}

async function readTournamentRound(request: Request, signal: AbortSignal) {
  const { config, botIds, roundIndex: requestedIndex } = await readMatchRequest(request);
  signal.throwIfAborted();
  const roundIndex = requestedIndex ?? tournamentBiomes.indexOf(config.biome);
  if (typeof roundIndex !== "number") throw new Error("Invalid tournament round index");

  const integerIndex = Number.isSafeInteger(roundIndex);
  const nonnegativeIndex = roundIndex >= 0;
  const validIndex = integerIndex && nonnegativeIndex;
  if (!validIndex) throw new Error("Invalid tournament round index");

  const bots = selectBots(await discoverBots(), botIds);
  return { bots, config, roundIndex };
}

async function readMatchRequest(request: Request) {
  const body = (await request.json()) as {
    config?: unknown;
    botIds?: unknown;
    roundIndex?: unknown;
  } | null;
  const config = parseUiConfig(body?.config);
  if (!Array.isArray(body?.botIds)) throw new Error(`Select 1 to ${MAX_BOTS} bot instances`);

  return { config, botIds: body.botIds, roundIndex: body.roundIndex };
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
