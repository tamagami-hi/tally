import { z } from "zod";
import { addPhase, closePhase, commitWaitingRecords, listPhases } from "@tally/core";
import { defined } from "../defined.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

export function registerPhaseTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "phase_add",
    {
      description: "Add a phase to the build (operator session only): a stretch of work with one goal, closed as a whole. Milestones are added to it with milestone_add, which takes its id as `stage`. `decision` names the decision that approved its plan.",
      inputSchema: {
        sessionId: z.string(),
        id: z.string().describe("1 to 40 letters, digits, - or _, starting with a letter or a digit, for example G"),
        name: z.string().describe("the phase's name, 1 to 80 characters, for example exports"),
        goal: z.string().describe("what the phase is for, one sentence of 1 to 500 characters"),
        weight: z.number().int().positive().describe("the phase's share of the build's progress, a positive whole number"),
        decision: z.string().optional().describe("the id of the decision that approved the phase's plan, 1 to 200 characters, for example DEC-12"),
      },
    },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo, session) => ok(await addPhase(repo, session, defined(input)))),
  );
  server.registerTool(
    "phase_list",
    {
      description: "The build's phases: each one's goal, whether it is open or closed, how many of its tasks are landed, and `left`, what still stops an open phase from closing. Report `left` to the operator before asking to close a phase.",
      inputSchema: { state: z.enum(["open", "closed"]).optional().describe("only phases in this state"), ...WHERE },
    },
    ({ state, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok({ phases: await listPhases(repo, defined({ state })) })),
  );
  server.registerTool(
    "phase_close",
    {
      description: "Close a phase (operator session only, and only on the operator's word: a phase's end is their gate). Refused while a task of the phase is not landed, while main holds a commit the ledger does not record, or while one of its tracks is landing. It closes the phase's landed tracks, removing their worktrees, and commits every waiting record as one commit. A closed phase takes no new milestone or task.",
      inputSchema: {
        sessionId: z.string(),
        phase: z.string().describe("the phase's id, as phase_list shows it, for example G"),
        summary: z.string().describe("what the phase delivered, 1 to 500 characters; it is the body of the records commit and goes to every open session"),
      },
    },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo, session) => ok(await closePhase(repo, session, input))),
  );
  server.registerTool(
    "records_commit",
    {
      description: "Commit the record changes that wait on disk (operator session only), with `why` in the commit's subject. A repository that commits its records at each phase's end needs this only before the operator pushes in the middle of a phase.",
      inputSchema: { sessionId: z.string(), why: z.string().describe("why the records are committed now, in a line of 1 to 200 characters, for example before the operator pushes") },
    },
    ({ sessionId, why }) => inSession(source, sessionId, async (repo, session) => ok(await commitWaitingRecords(repo, session, why))),
  );
}
