import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { relative, sep } from "node:path";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { ENDED_LIMIT, MOST_ENDED, Records, TallyError, collect, cycleList, cycleView, doneWork, endedSessions, findEvidence, listDocs, evidenceIndex, messageOf, readDoc, readDocuments, readEvidence, worktreeOf, type Config, type Repo } from "@tally/core";
import { GRAPH_LIMIT, commitCount, commitGraph, graphBranches } from "./graph.ts";
import { fileOrNull } from "./static.ts";
import type { Watcher } from "./watcher.ts";

export interface Served {
  repo: Repo;
  watcher: Watcher;
}

export type Serve = (c: Context) => Promise<Served>;

const PING_MS = 15_000;
const WHOLE_NUMBER = /^[1-9]\d*$/;
const CYCLE_NUMBER = /^[1-9]\d{0,14}$/;

const redacted = (env: Record<string, string>): Record<string, string> => Object.fromEntries(Object.keys(env).map((key) => [key, "(set)"]));

export function redactedConfig(config: Config): Config {
  const { env, landing } = config.commands;
  const hidden = landing?.env === undefined ? {} : { landing: { ...landing, env: redacted(landing.env) } };
  return { ...config, commands: { ...config.commands, env: redacted(env), ...hidden } };
}

async function insideRepo(repo: Repo, path: string): Promise<boolean> {
  const real = await realpath(path).catch(() => null);
  if (real === null) return true;
  for (const folder of [repo.root, ...repo.config.tracks.map((track) => worktreeOf(repo, track))]) {
    const base = await realpath(folder).catch(() => folder);
    if (real === base || real.startsWith(`${base}${sep}`)) return true;
  }
  return false;
}

export function eventStream(c: Context, watcher: Watcher): Response {
  return streamSSE(c, async (stream) => {
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
  });
}

export function repoRoutes(served: Serve): Hono {
  const api = new Hono();
  api.get("/snapshot", async (c) => c.json(await (await served(c)).watcher.current()));
  api.get("/status", async (c) => c.json((await (await served(c)).watcher.current()).status));
  api.get("/graph", async (c) => {
    const limit = c.req.query("limit") ?? String(GRAPH_LIMIT);
    if (!WHOLE_NUMBER.test(limit)) return c.json({ error: "limit must be a whole number above zero" }, 400);
    const { repo } = await served(c);
    const branches = graphBranches(repo.config);
    const total = await commitCount(repo.root, branches);
    return c.json({ commits: await commitGraph(repo.root, branches, Math.min(Number(limit), Math.max(total, 1))), total });
  });
  api.get("/done", async (c) => {
    const { repo, watcher } = await served(c);
    return c.json(await doneWork(repo, (await watcher.current()).status));
  });
  api.get("/cycles", async (c) => {
    const limit = c.req.query("limit");
    if (limit !== undefined && !WHOLE_NUMBER.test(limit)) return c.json({ error: "limit must be a whole number above zero" }, 400);
    return c.json(await cycleList((await served(c)).repo, limit === undefined ? {} : { limit: Number(limit) }));
  });
  api.get("/cycles/:n/done", async (c) => {
    const n = c.req.param("n");
    if (!CYCLE_NUMBER.test(n)) return c.json({ error: `a cycle is named by its number, not '${n}'` }, 400);
    const view = await cycleView((await served(c)).repo, Number(n));
    return c.json(await doneWork(view, await collect(view, await new Records(view).readLedger())));
  });
  api.get("/done/sessions", async (c) => {
    const limit = c.req.query("limit") ?? String(ENDED_LIMIT);
    if (!WHOLE_NUMBER.test(limit) || Number(limit) > MOST_ENDED) return c.json({ error: `limit must be a whole number from 1 to ${MOST_ENDED}` }, 400);
    return c.json(await endedSessions((await served(c)).repo, { limit: Number(limit) }));
  });
  api.get("/ledger", async (c) => c.json(await new Records((await served(c)).repo).readLedger()));
  api.get("/config", async (c) => c.json(redactedConfig((await served(c)).repo.config)));
  api.get("/evidence", async (c) => c.json({ milestones: await evidenceIndex((await served(c)).repo) }));
  api.get("/evidence/log/:id", async (c) => {
    const found = await findEvidence((await served(c)).repo, c.req.param("id"));
    if (found === null || found.record.log === undefined) return c.json({ error: "no log for that record" }, 404);
    if (!(await insideRepo((await served(c)).repo, found.record.log.path))) return c.json({ error: "that record's log is not inside the repository" }, 404);
    const body = await fileOrNull(found.record.log.path);
    if (body === null) return c.json({ error: `the log is gone: ${found.record.log.path}` }, 410);
    const hash = createHash("sha256").update(body).digest("hex");
    return c.body(new Uint8Array(body), 200, { "content-type": "text/plain; charset=utf-8", "x-tally-log": hash === found.record.log.sha256 ? "unchanged" : "changed" });
  });
  api.get("/evidence/:milestone", async (c) => c.json(await readEvidence((await served(c)).repo, c.req.param("milestone"))));
  api.get("/docs", async (c) => {
    const { repo } = await served(c);
    const records = `${relative(repo.root, repo.recordsDir)}${sep}`;
    return c.json({ documents: (await readDocuments(repo)).documents, records: (await listDocs(repo)).filter((path) => path.startsWith(records)) });
  });
  api.get("/docs/read", async (c) => {
    const path = c.req.query("path");
    if (path === undefined) return c.json({ error: "the path is missing" }, 400);
    try {
      return c.json(await readDoc((await served(c)).repo, path));
    } catch (error: unknown) {
      if (!(error instanceof TallyError)) throw error;
      return c.json({ error: messageOf(error) }, 404);
    }
  });
  api.get("/events", async (c) => eventStream(c, (await served(c)).watcher));
  return api;
}
