import { z } from "zod";
import { TallyError, contextPack, isOperator, listDocs, readDecisions, readDoc, searchDocs, standingNow, writeClaudeView } from "@tally/core";
import { LIMIT, latest } from "../filters.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

export function registerDocTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "docs_list",
    { description: "The documents a session may read: RULES.md, CLAUDE.md, README.md and docs/**/*.md|json.", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok({ documents: await listDocs(repo) })),
  );
  server.registerTool(
    "docs_read",
    { description: "Read one document by its repository-relative path.", inputSchema: { path: z.string(), ...WHERE } },
    ({ path, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const doc = await readDoc(repo, path);
      return ok(doc, doc.text);
    }),
  );
  server.registerTool(
    "docs_search",
    { description: "Case-insensitive search across the documents; each hit is a path, a line and its text.", inputSchema: { query: z.string(), limit: z.number().int().positive().max(200).default(50), ...WHERE } },
    ({ query, limit, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok({ hits: await searchDocs(repo, query, limit) })),
  );
  server.registerTool(
    "decision_list",
    { description: "The decisions in force and the replaced rows, narrowed by group and by a list of ids, and by `limit` to the most recent of each; decisions are entered only by the operator, with `tally decision add|replace --operator`.", inputSchema: { group: z.string().optional(), ids: z.array(z.string()).optional(), limit: LIMIT, ...WHERE } },
    ({ group, ids, limit, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const file = await readDecisions(repo);
      const keep = <T extends { group: string; id: string }>(rows: T[]): T[] => latest(rows.filter((r) => (group === undefined || r.group === group) && (ids === undefined || ids.includes(r.id))), limit);
      return ok({ decisions: keep(file.decisions), replaced: keep(file.replaced) });
    }),
  );
  server.registerTool(
    "views_claude",
    { description: "The standing block CLAUDE.md carries between its tally:standing markers, computed from the records now; with write (operator session only) it is written into the repository's CLAUDE.md.", inputSchema: { sessionId: z.string(), write: z.boolean().default(false) } },
    ({ sessionId, write }) => inSession(source, sessionId, async (repo, session) => {
      if (write && !isOperator(repo, session)) throw new TallyError("only an operator session writes CLAUDE.md");
      const block = await standingNow(repo);
      const result = write ? await writeClaudeView(repo) : await writeClaudeView(repo, { check: true });
      return ok({ ...result, block }, block);
    }),
  );
  server.registerTool(
    "context_pack",
    { description: "What a session at a level reads at its start, assembled now from the records: project (rules, milestones, sessions, locks), track (its tasks and hand-off), milestone (its tasks and evidence counts), task (the task, its evidence and reviews, the hand-off).", inputSchema: { level: z.enum(["project", "track", "milestone", "task"]), track: z.string().optional(), milestone: z.string().optional(), task: z.string().optional(), ...WHERE } },
    ({ level, track, milestone, task, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const pack = await contextPack(repo, { level, ...(track === undefined ? {} : { track }), ...(milestone === undefined ? {} : { milestone }), ...(task === undefined ? {} : { task }) });
      return ok(pack, pack.text);
    }),
  );
}
