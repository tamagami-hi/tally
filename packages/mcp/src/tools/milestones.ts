import { z } from "zod";
import { Records, TallyError, commitRecords, editMilestone, isOperator, removeMilestone } from "@tally/core";
import { ok } from "../respond.ts";
import { inSession, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const dropInput = z.strictObject({ id: z.string(), why: z.string(), decision: z.string().optional() });

export function registerMilestoneTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "milestone_edit",
    {
      description: "Change a milestone (operator session): its `name`, its `waits` line (null clears it), or `drop` deliverables, each with why and an optional decision, so ledger_check no longer lists them. A deliverable a landed task covers cannot be dropped.",
      inputSchema: { sessionId: z.string(), milestone: z.string(), name: z.string().optional(), waits: z.string().nullable().optional(), drop: z.array(dropInput).min(1).optional() },
    },
    ({ sessionId, milestone, name, waits, drop }) => inSession(source, sessionId, async (repo, session) => {
      if (!isOperator(repo, session)) throw new TallyError("only an operator session edits a milestone; a track asks with question_add");
      const by = { track: session.track, agent: session.agent };
      const message = await new Records(repo).update((ledger) => editMilestone(ledger, { milestone, name, waits, drop }, by, new Date().toISOString()));
      return ok({ message, commit: await commitRecords(repo, message) });
    }),
  );
  server.registerTool(
    "milestone_remove",
    {
      description: "Remove a milestone (operator session) with its planned tasks, when none of its tasks has landed, is claimed or is in the landing queue. Its run records stay, and the tracks whose tasks waited on it are told. A landed task's milestone is refused: it is the record of its commits.",
      inputSchema: { sessionId: z.string(), milestone: z.string(), why: z.string(), decision: z.string().optional() },
    },
    ({ sessionId, milestone, why, decision }) => inSession(source, sessionId, async (repo, session) => {
      const removed = await removeMilestone(repo, { milestone, why, decision }, session);
      return ok({ ...removed, commit: await commitRecords(repo, removed.message) });
    }),
  );
}
