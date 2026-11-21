import { Hono, type Context } from "hono";
import { NotListed, TallyError, messageOf, type StartDefaults, type Usage } from "@tally/core";
import { SERVER_VERSION, boundRepo, manyRepos, mcpEndpoint, usageNow, type RepoSource } from "@tally/mcp";
import { roleRoutes, servingRoles } from "./roles.ts";
import { cliRoutes, type CliRunner } from "./cli-api.ts";
import { listFolders } from "./folders.ts";
import { Forbidden, loopbackOnly } from "./guard.ts";
import type { Hub } from "./hub.ts";
import { operatorRoutes } from "./operator.ts";
import { eventStream, repoRoutes } from "./repo-api.ts";
import { staticFiles } from "./static.ts";

export interface ServiceOptions {
  hub: Hub;
  webDir: string;
  workspace: string;
  defaults?: StartDefaults;
  cli?: CliRunner;
  usage?: Usage;
}

const statusOf = (error: TallyError): 400 | 403 | 404 => (error instanceof NotListed ? 404 : error instanceof Forbidden ? 403 : 400);

export function createServiceApp({ hub, webDir, workspace, defaults, cli, usage }: ServiceOptions): Hono {
  const app = new Hono();
  app.use("*", loopbackOnly());
  app.onError((error, c) => {
    if (error instanceof TallyError) return c.json({ error: messageOf(error) }, statusOf(error));
    process.stderr.write(`tally failed on ${c.req.method} ${new URL(c.req.url).pathname}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return c.json({ error: "tally failed; the service's log has the detail" }, 500);
  });
  app.get("/api/health", (c) => c.json({ ok: true, version: SERVER_VERSION }));
  app.get("/api/usage", (c) => c.json(usageNow(usage)));
  app.get("/api/repos", async (c) => {
    const repos = await hub.overview();
    const problem = hub.repos.listProblem();
    return c.json({ workspace, repos, ...(problem === undefined ? {} : { problem }) });
  });
  app.get("/api/fs", async (c) => c.json(await listFolders(workspace, hub.repos, c.req.query("dir"))));
  app.route("/api/r/:name", repoRoutes((c) => hub.get(c.req.param("name") ?? "")));
  app.route("/api", roleRoutes());
  app.route("/api", operatorRoutes({ hub, workspace, ...(defaults === undefined ? {} : { defaults }) }));
  app.route("/api", cliRoutes(hub, cli, workspace));
  app.route("/api", repoRoutes(() => hub.default()));
  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
  const mcp = mcpEndpoint(manyRepos(hub.repos), usage);
  app.all("/mcp", (c) => mcp.fetch(c.req.raw));
  servingRoles(app, "/mcp", async () => manyRepos(hub.repos), usage);
  const bound = async (c: Context): Promise<RepoSource | Response> => {
    const name = c.req.param("name") ?? "";
    if (!(await hub.repos.entries()).some((entry) => entry.name === name)) return c.json({ error: `no repository ${name} is listed; repo_list names those that are` }, 404);
    return boundRepo(hub.repos, name);
  };
  app.all("/r/:name/mcp", async (c) => {
    const from = await bound(c);
    return from instanceof Response ? from : mcpEndpoint(from, usage).fetch(c.req.raw);
  });
  servingRoles(app, "/r/:name/mcp", bound, usage);
  app.get("/events", async (c) => eventStream(c, (await hub.default()).watcher));
  app.get("/*", staticFiles(webDir));
  return app;
}
