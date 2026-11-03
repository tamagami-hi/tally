import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { TallyError, addQuestion, contextPack, getSession, isOperator, listDocs, readDoc, readQuestions, searchDocs, standingNow, writeClaudeView, type Repo } from "@tally/core";
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
    "question_add",
    { description: "Add a question row for the operator (a choice that changes what a result means or costs): the question and the conservative behaviour built meanwhile. Takes the next row under the lock.", inputSchema: { sessionId: z.string(), group: z.string(), question: z.string(), meanwhile: z.string() } },
    ({ sessionId, group, question, meanwhile }) => attempt(async () => {
      const session = await getSession(repo, sessionId);
      return ok(await addQuestion(repo, { group, question, meanwhile, by: session.agent }));
    }),
  );
  server.registerTool(
    "question_list",
    { description: "The open question rows, the next row number, and how many were answered.", inputSchema: {} },
    () => attempt(async () => ok((await readQuestions(repo)) ?? { schema: 1, nextRow: 1, open: [], answered: [] })),
  );
  server.registerTool(
    "views_claude",
    { description: "The standing block CLAUDE.md carries between its tally:standing markers, computed from the records now; with write (operator session only) it is written into the repository's CLAUDE.md.", inputSchema: { sessionId: z.string(), write: z.boolean().default(false) } },
    ({ sessionId, write }) => attempt(async () => {
      const session = await getSession(repo, sessionId);
      if (write && !isOperator(repo, session)) throw new TallyError("only an operator session writes CLAUDE.md");
      const block = await standingNow(repo);
      const result = write ? await writeClaudeView(repo) : await writeClaudeView(repo, { check: true });
      return ok({ ...result, block }, block);
    }),
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
