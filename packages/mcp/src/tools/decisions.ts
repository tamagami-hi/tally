import { z } from "zod";
import { DECISION_STATES, MOST_SAID, answerWithDecision, recordDecision, setStatusBySession } from "@tally/core";
import type { ToolHost } from "../decorate.ts";
import { limitedText } from "../limited.ts";
import { acceptLines } from "../planned-task.ts";
import { ok } from "../respond.ts";
import { inSession, type RepoSource } from "../source.ts";

const said = limitedText(MOST_SAID, 1, "said");
const QUESTION_ID = z.union([z.string(), z.number().int().positive()]);

export function registerDecisionTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "decision_record",
    {
      description: "Record a decision on the operator's word (operator session): their own words, quoted, go in `said`. One you reached yourself is not a decision; a track asks with question_add. `id` defaults to the next DEC-<n>; an existing id needs `replaces`. It is unconfirmed until the operator confirms it on the board.",
      inputSchema: { sessionId: z.string(), group: z.string().min(1), text: z.string().min(1), said, id: z.string().min(1).optional(), section: z.string().min(1).optional(), status: z.string().min(1).optional(), state: z.enum(DECISION_STATES).optional(), replaces: z.object({ why: z.string().min(1) }).optional(), accept: acceptLines.optional(), paths: z.array(z.string().min(1)).optional() },
    },
    ({ sessionId, group, text, said: words, id, section, status, state, replaces, accept, paths }) => inSession(source, sessionId, async (repo, session) => ok(await recordDecision(repo, session, { group, text, said: words, id, section, status, state, replaces, accept, paths }))),
  );
  server.registerTool(
    "decision_status",
    {
      description: "Set a decision's status and state (operator session), as tally decision setStatus does. A status that says withdrawn ends a dispute.",
      inputSchema: { sessionId: z.string(), id: z.string().min(1), group: z.string().min(1).optional(), status: z.string().min(1), state: z.enum(DECISION_STATES).optional() },
    },
    ({ sessionId, id, group, status, state }) => inSession(source, sessionId, async (repo, session) => ok(await setStatusBySession(repo, session, { id, group, status, state }))),
  );
  server.registerTool(
    "question_answer",
    {
      description: "Answer an open question with a decision's id (operator session), as tally question answer does. Refused when the question is not open or no decision has that id.",
      inputSchema: { sessionId: z.string(), id: QUESTION_ID, decision: z.string().min(1), said: said.optional() },
    },
    ({ sessionId, id, decision, said: words }) => inSession(source, sessionId, async (repo, session) => ok(await answerWithDecision(repo, session, { id, decision, said: words }))),
  );
}
