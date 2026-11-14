import { z } from "zod";
import { MOST_EDIT_WHY, MOST_QUESTION_TEXT, addQuestion, editQuestion, isOperator, questionId, readQuestions, rowOf, type Question } from "@tally/core";
import { LIMIT, latest } from "../filters.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const text = z.string().min(1).max(MOST_QUESTION_TEXT);

function shown<T extends Question>(row: T, history: boolean): Omit<T, "edits"> & { id: string; edited?: number; edits?: Question["edits"] } {
  const { edits, ...rest } = row;
  const count = edits?.length ?? 0;
  return { id: questionId(row.row), ...rest, ...(count === 0 ? {} : { edited: count }), ...(history && edits !== undefined ? { edits } : {}) };
}

export function registerQuestionTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "question_add",
    {
      description: "Ask the operator a question (a choice that changes what a result means or costs): the question and the conservative behaviour built meanwhile. Answers its id, Q-<number>; the next number is taken under the lock. An operator session may give `number` to line up with a plan's numbering, forward only.",
      inputSchema: { sessionId: z.string(), group: z.string(), question: text, meanwhile: text, number: z.number().int().positive().optional() },
    },
    ({ sessionId, group, question, meanwhile, number }) => inSession(source, sessionId, async (repo, session) => ok(await addQuestion(repo, { group, question, meanwhile, by: session.agent, track: session.track, number }, { operator: isOperator(repo, session) }))),
  );
  server.registerTool(
    "question_list",
    {
      description: "The open questions, each with its `id` (Q-24), the next number and how many were answered; `answered: true` adds the answered ones. `ids`, `group` and `limit` (the latest) narrow the rows, never the counts. A row says `edited`, how many times; `history: true` adds its `edits`.",
      inputSchema: { answered: z.boolean().default(false), ids: z.array(z.union([z.string(), z.number().int().positive()])).optional(), group: z.string().optional(), history: z.boolean().default(false), limit: LIMIT, ...WHERE },
    },
    ({ answered, ids, group, history, limit, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const rows = ids?.map(rowOf);
      const { answered: done, open, ...rest } = (await readQuestions(repo)) ?? { schema: 1, nextRow: 1, open: [], answered: [] };
      const keep = <T extends Question>(all: T[]) => latest(all.filter((q) => (rows === undefined || rows.includes(q.row)) && (group === undefined || q.group === group)), limit).map((q) => shown(q, history));
      return ok({ ...rest, open: keep(open), answeredCount: done.length, ...(answered ? { answered: keep(done) } : {}) });
    }),
  );
  server.registerTool(
    "question_edit",
    {
      description: "Edit an open question or its meanwhile (an operator session, or the agent that asked it), saying why. The question keeps what it said before in `edits`, oldest first. An answered question is refused: ask a new one that names it.",
      inputSchema: { sessionId: z.string(), id: z.union([z.string(), z.number().int().positive()]), question: text.optional(), meanwhile: text.optional(), why: z.string().min(1).max(MOST_EDIT_WHY) },
    },
    ({ sessionId, id, question, meanwhile, why }) => inSession(source, sessionId, async (repo, session) => ok(await editQuestion(repo, { agent: session.agent, track: session.track, operator: isOperator(repo, session) }, { id, question, meanwhile, why }))),
  );
}
