import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { Records, type Config, type Repo } from "@tally/core";
import type { Watcher } from "./watcher.ts";

export interface AppOptions {
  repo: Repo;
  watcher: Watcher;
  webDir: string;
}

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
  app.get("/api/graph", async (c) => c.json((await watcher.current()).graph));
  app.get("/api/ledger", async (c) => c.json(await new Records(repo).readLedger()));
  app.get("/api/config", (c) => c.json(redactedConfig(repo.config)));
  app.get("/api/*", (c) => c.json({ error: "not found" }, 404));
  app.get("/events", (c) =>
    streamSSE(c, async (stream) => {
      const send = (snapshot: unknown): Promise<void> => stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });
      await send(await watcher.current());
      let open = true;
      const unsubscribe = watcher.subscribe((snapshot) => void send(snapshot));
      stream.onAbort(() => {
        open = false;
        unsubscribe();
      });
      while (open) {
        await stream.sleep(15_000);
        if (open) await stream.writeSSE({ event: "ping", data: new Date().toISOString() });
      }
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
