import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";
import { createGameApi } from "./http/game-api.ts";
import { createWebAssets } from "./http/web-assets.ts";
import { isMainModule } from "./runtime/entrypoint.ts";

async function webRequest(request: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else if (value !== undefined) headers.set(name, value);
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  const method = request.method ?? "GET";
  if (method === "GET" || method === "HEAD") return new Request(url, { method, headers });
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("Request body exceeds 64 KB");
    chunks.push(buffer);
  }
  return new Request(url, { method, headers, body: Buffer.concat(chunks) });
}

export async function startServer(port = Number(process.env.PORT ?? 3000), watch = false) {
  const assets = await createWebAssets(watch);
  const api = createGameApi();
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = await webRequest(incoming);
      const path = new URL(request.url).pathname;
      let response: Response;
      if (path.startsWith("/api/")) response = await api.fetch(request);
      else {
        const asset =
          request.method === "GET" || request.method === "HEAD"
            ? await assets.get(path)
            : undefined;
        response = asset
          ? new Response(asset.body as BodyInit, {
              headers: { "Content-Type": asset.contentType, "Cache-Control": "no-store" },
            })
          : Response.json({ error: "Not found" }, { status: 404 });
      }
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(
        incoming.method === "HEAD" ? undefined : Buffer.from(await response.arrayBuffer()),
      );
    } catch (error) {
      outgoing.writeHead(400, { "Content-Type": "application/json" });
      outgoing.end(
        JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      );
    }
  });
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
  } catch (error) {
    api.dispose();
    await assets.dispose();
    throw error;
  }
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing server address");
  return {
    server,
    port: address.port,
    async dispose() {
      api.dispose();
      const closed = new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      server.closeAllConnections();
      await Promise.all([closed, assets.dispose()]);
    },
  };
}

if (isMainModule(import.meta.url)) {
  const app = await startServer(undefined, process.argv.includes("--watch"));
  console.log(`Resource hunt → http://127.0.0.1:${app.port}`);
  const shutdown = async () => {
    await app.dispose();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}
