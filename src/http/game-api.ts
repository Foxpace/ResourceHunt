import { createGame } from "../runtime/matches.ts";
import { normalizeConfig } from "../engine/config.ts";
import { DEFAULT_CONFIG, MAX_BOTS } from "../engine/types.ts";
import { discoverBots, selectBots, getDefaultBotIds } from "../runtime/bots.ts";
import type { Game } from "../engine/game.ts";

export function createGameApi() {
  const sessions = new Map<string, { game: Game; touched: number; busy: boolean }>();
  const cleanup = setInterval(() => {
    for (const [id, session] of sessions)
      if (!session.busy && Date.now() - session.touched > 30 * 60_000) {
        session.game.dispose();
        sessions.delete(id);
      }
  }, 60_000);
  cleanup.unref();
  const json = (data: unknown, status = 200) =>
    Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
  return {
    async fetch(request: Request): Promise<Response> {
      const url = new URL(request.url);
      // Same-origin local UI only. Bots are trusted local code, not uploaded code.
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        return json({ error: "Cross-origin requests are disabled" }, 403);
      try {
        if (url.pathname === "/api/bots" && request.method === "GET") {
          const catalog = await discoverBots();
          return json({
            bots: catalog.bots.map(({ file, ...bot }) => bot),
            errors: catalog.errors,
            defaults: DEFAULT_CONFIG,
            defaultBotIds: getDefaultBotIds(catalog),
          });
        }
        if (url.pathname === "/api/games" && request.method === "POST") {
          if (sessions.size >= 12)
            return json({ error: "Too many open matches. Reset or close another match." }, 429);
          const body = (await request.json()) as { config?: unknown; botIds?: unknown };
          if (!body.config || typeof body.config !== "object" || Array.isArray(body.config))
            throw new Error("Game configuration is required");
          const config = normalizeConfig(body.config);
          if (config.width * config.height * config.ticks > 3_000_000)
            throw new Error(
              "UI replays support up to 3 million cells × ticks. Use the headless CLI for larger matches.",
            );
          if (!Array.isArray(body.botIds))
            throw new Error(`Select 1 to ${MAX_BOTS} unique bot IDs`);
          const catalog = await discoverBots();
          const bots = selectBots(catalog, body.botIds);
          const game = await createGame(bots, config);
          const id = crypto.randomUUID();
          sessions.set(id, { game, touched: Date.now(), busy: false });
          return json({ id, snapshot: game.snapshot() }, 201);
        }
        const match = /^\/api\/games\/([a-f0-9-]+)(?:\/(step|replay))?$/.exec(url.pathname);
        if (match) {
          const session = sessions.get(match[1]!);
          if (!session) return json({ error: "Match expired. Create a new match." }, 404);
          session.touched = Date.now();
          if (request.method === "DELETE" && !match[2]) {
            if (session.busy) return json({ error: "Wait for the current tick to finish" }, 409);
            session.game.dispose();
            sessions.delete(match[1]!);
            return json({ ok: true });
          }
          if (request.method === "GET") {
            if (session.busy) return json({ error: "Wait for the current tick to finish" }, 409);
            if (match[2] === "replay") return json(session.game.replay());
            if (!match[2])
              return json({ snapshot: session.game.snapshot(), result: session.game.result() });
          }
          if (request.method === "POST" && match[2] === "step") {
            if (session.busy) return json({ error: "A tick is already in progress" }, 409);
            session.busy = true;
            try {
              const snapshot = await session.game.step();
              return json({
                snapshot,
                result: snapshot.finished ? session.game.result() : undefined,
              });
            } finally {
              session.busy = false;
            }
          }
        }
        return json({ error: "Not found" }, 404);
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : String(error) }, 400);
      }
    },
    dispose() {
      clearInterval(cleanup);
      for (const session of sessions.values()) session.game.dispose();
      sessions.clear();
    },
  };
}
