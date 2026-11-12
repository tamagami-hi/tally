import { Hono } from "hono";
import type { Repo } from "@tally/core";
import { mcpHandler } from "@tally/mcp";
import { eventStream, repoRoutes } from "./repo-api.ts";
import { staticFiles } from "./static.ts";
import type { Watcher } from "./watcher.ts";

export { redactedConfig } from "./repo-api.ts";

export interface AppOptions {
  repo: Repo;
  watcher: Watcher;
  webDir: string;
}

export function createApp({ repo, watcher, webDir }: AppOptions): Hono {
  const app = new Hono();
  app.route("/api", repoRoutes(() => Promise.resolve({ repo, watcher })));
  app.get("/api/*", (c) => c.json({ error: "not found" }, 404));
  const mcp = mcpHandler(repo);
  app.all("/mcp", (c) => mcp(c.req.raw));
  app.get("/events", (c) => eventStream(c, watcher));
  app.get("/*", staticFiles(webDir));
  return app;
}
