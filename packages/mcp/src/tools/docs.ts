import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { contextPack, listDocs, readDoc, searchDocs, type Repo } from "@tally/core";
import { attempt, ok } from "../respond.ts";

export function registerDocTools(server: McpServer, repo: Repo): void {
  server.registerTool(
    "docs_list",
    { description: "The documents a session may read: RULES.md, CLAUDE.md, README.md and docs/**/*.md|json.", inputSchema: {} },
    () => attempt(async () => ok({ documents: await listDocs(repo) })),
  );
  server.registerTool(
    "docs_read",
    { description: "Read one document by its repository-relative path.", inputSchema: { path: z.string() } },
    ({ path }) => attempt(async () => {
      const doc = await readDoc(repo, path);
      return ok(doc, doc.text);
    }),
  );
  server.registerTool(
    "docs_search",
    { description: "Case-insensitive search across the documents; each hit is a path, a line and its text.", inputSchema: { query: z.string(), limit: z.number().int().positive().max(200).default(50) } },
    ({ query, limit }) => attempt(async () => ok({ hits: await searchDocs(repo, query, limit) })),
  );
  server.registerTool(
    "context_pack",
    { description: "Exactly what a session at a level reads at its start, assembled now from the records: project (rules, milestones, sessions, locks), track (its tasks and hand-off), milestone (its tasks and evidence counts), task (the task, its evidence, the hand-off).", inputSchema: { level: z.enum(["project", "track", "milestone", "task"]), track: z.string().optional(), milestone: z.string().optional(), task: z.string().optional() } },
    ({ level, track, milestone, task }) => attempt(async () => {
      const pack = await contextPack(repo, { level, ...(track === undefined ? {} : { track }), ...(milestone === undefined ? {} : { milestone }), ...(task === undefined ? {} : { task }) });
      return ok(pack, pack.text);
    }),
  );
}
