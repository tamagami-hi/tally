import { Hono } from "hono";
import { LiveRepo, type Repo, type Usage } from "@tally/core";
import { mcpHandler, usageNow } from "@tally/mcp";
import { eventStream, repoRoutes } from "./repo-api.ts";
import { staticFiles } from "./static.ts";
import type { Watcher } from "./watcher.ts";

export { redactedConfig } from "./repo-api.ts";

export interface AppOptions {
  repo: Repo;
  watcher: Watcher;
  webDir: string;
  usage?: Usage;
}

export function createApp({ repo, watcher, webDir, usage }: AppOptions): Hono {
  const app = new Hono();
  const live = new LiveRepo(repo);
  app.get("/api/usage", (c) => c.json(usageNow(usage)));
  app.route("/api", repoRoutes(async () => ({ repo: await live.current(), watcher })));
  app.get("/api/*", (c) => c.json({ error: "not found" }, 404));
  const mcp = mcpHandler(repo, usage);
  app.all("/mcp", (c) => mcp(c.req.raw));
  app.get("/events", (c) => eventStream(c, watcher));
  app.get("/*", staticFiles(webDir));
  return app;
}
