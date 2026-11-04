import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, relative, sep } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Records, TallyError, findEvidence, listDocs, messageOf, readAllEvidence, readDoc, readDocuments, readEvidence, type Config, type Repo } from "@tally/core";
import { mcpHandler } from "@tally/mcp";
import { GRAPH_LIMIT, commitCount, commitGraph } from "./graph.ts";
import type { Watcher } from "./watcher.ts";

export interface AppOptions {
  repo: Repo;
  watcher: Watcher;
  webDir: string;
}

const PING_MS = 15_000;
const WHOLE_NUMBER = /^[1-9]\d*$/;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

export function redactedConfig(config: Config): Config {
  const env = Object.fromEntries(Object.keys(config.commands.env).map((key) => [key, "(set)"]));
  return { ...config, commands: { ...config.commands, env } };
}

async function file(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

export function createApp({ repo, watcher, webDir }: AppOptions): Hono {
  const app = new Hono();
  app.get("/api/snapshot", async (c) => c.json(await watcher.current()));
  app.get("/api/status", async (c) => c.json((await watcher.current()).status));
  app.get("/api/graph", async (c) => {
    const limit = c.req.query("limit") ?? String(GRAPH_LIMIT);
    if (!WHOLE_NUMBER.test(limit)) return c.json({ error: "limit must be a whole number above zero" }, 400);
    const total = await commitCount(repo.root);
    return c.json({ commits: await commitGraph(repo.root, Math.min(Number(limit), Math.max(total, 1))), total });
  });
  app.get("/api/ledger", async (c) => c.json(await new Records(repo).readLedger()));
  app.get("/api/config", (c) => c.json(redactedConfig(repo.config)));
  app.get("/api/evidence", async (c) => c.json({ milestones: await readAllEvidence(repo) }));
  app.get("/api/evidence/log/:id", async (c) => {
    const found = await findEvidence(repo, c.req.param("id"));
    if (found === null || found.record.log === undefined) return c.json({ error: "no log for that record" }, 404);
    const body = await file(found.record.log.path);
    if (body === null) return c.json({ error: `the log is gone: ${found.record.log.path}` }, 410);
    const hash = createHash("sha256").update(body).digest("hex");
    return c.body(new Uint8Array(body), 200, { "content-type": "text/plain; charset=utf-8", "x-tally-log": hash === found.record.log.sha256 ? "unchanged" : "changed" });
  });
  app.get("/api/evidence/:milestone", async (c) => c.json(await readEvidence(repo, c.req.param("milestone"))));
  app.get("/api/docs", async (c) => {
    const records = `${relative(repo.root, repo.recordsDir)}${sep}`;
    return c.json({ documents: (await readDocuments(repo)).documents, records: (await listDocs(repo)).filter((path) => path.startsWith(records)) });
  });
  app.get("/api/docs/read", async (c) => {
    const path = c.req.query("path");
    if (path === undefined) return c.json({ error: "the path is missing" }, 400);
    try {
      return c.json(await readDoc(repo, path));
    } catch (error: unknown) {
      if (!(error instanceof TallyError)) throw error;
      return c.json({ error: messageOf(error) }, 404);
    }
  });
  app.get("/api/*", (c) => c.json({ error: "not found" }, 404));
  const mcp = mcpHandler(repo);
  app.all("/mcp", (c) => mcp(c.req.raw));
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (snapshot: unknown): Promise<void> => stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });
      await send(await watcher.current());
      const unsubscribe = watcher.subscribe((snapshot) => void send(snapshot));
      const ping = setInterval(() => void stream.writeSSE({ event: "ping", data: new Date().toISOString() }), PING_MS);
      await new Promise<void>((ended) => {
        stream.onAbort(ended);
        void watcher.stopped.then(ended);
      });
      clearInterval(ping);
      unsubscribe();
    }),
  );
  app.get("/*", async (c) => {
    const requested = normalize(decodeURIComponent(new URL(c.req.url).pathname));
    const wanted = requested === "/" || !extname(requested) ? "/index.html" : requested;
    const body = await file(join(webDir, wanted));
    if (body === null) return c.text("not found", 404);
    return c.body(new Uint8Array(body), 200, { "content-type": TYPES[extname(wanted)] ?? "application/octet-stream" });
  });
  return app;
}
