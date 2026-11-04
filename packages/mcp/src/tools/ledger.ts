import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  COVERED, Records, TallyError, addMilestone, assertMayWrite, claimTask, collect, commitRecords, findMilestone, findTask, getSession, isOperator,
  listClaims, listLocks, logLines, other, plan, recordTask, releaseClaim, resolveOnMain, rowsOf, unrecorded, wait, type Ledger, type Repo, type Session,
} from "@tally/core";
import { attempt, ok } from "../respond.ts";

async function recorded(repo: Repo, message: string): Promise<{ message: string; commit: string | null }> {
  return { message, commit: await commitRecords(repo, message) };
}

function taskTrack(ledger: Ledger, milestone: string, task: string): string | undefined {
  return findTask(findMilestone(ledger, milestone), task)?.track;
}

function scopedTrack(repo: Repo, session: Session, given: string | undefined): string {
  const track = given ?? session.track;
  assertMayWrite(repo, session, track);
  return track;
}

export function registerLedgerTools(server: McpServer, repo: Repo): void {
  const records = new Records(repo);
  const resolve = resolveOnMain(repo.root, repo.config.mainBranch);

  server.registerTool(
    "board_get",
    { description: "The build's status as the board shows it: stages, milestones, tasks, tracks, problems, plus the live claims and locks. scope 'mine' keeps only the session's track: its rows, their tasks and notes, its branch and its claims.", inputSchema: { scope: z.enum(["all", "mine"]).default("all"), sessionId: z.string().optional() } },
    ({ scope, sessionId }) => attempt(async () => {
      const status = await collect(repo, await records.readLedger());
      const claims = await listClaims(repo);
      const locks = await listLocks(repo);
      if (scope === "all") return ok({ ...status, claims, locks });
      if (sessionId === undefined) throw new TallyError("scope 'mine' needs the sessionId");
      const session = await getSession(repo, sessionId);
      return ok({ ...status, rows: rowsOf(status.rows, session.track), tracks: status.tracks.filter((t) => t.isMain || t.track === session.track), claims: claims.filter((c) => c.track === session.track), locks });
    }),
  );
  server.registerTool(
    "ledger_check",
    { description: "The commits on main the ledger does not account for; empty when every commit is recorded.", inputSchema: {} },
    () => attempt(async () => {
      const ledger = await records.readLedger();
      const missing = unrecorded(ledger, await logLines(repo.root, `${ledger.baseline}..${repo.config.mainBranch}`), repo.config.records.commitPrefix);
      return ok({ missing, covered: missing.length === 0 }, missing.length === 0 ? COVERED : missing.join("\n"));
    }),
  );
  server.registerTool(
    "milestone_add",
    { description: "Add an empty milestone to a stage (operator scope).", inputSchema: { sessionId: z.string(), id: z.string(), stage: z.string(), name: z.string(), track: z.string(), weight: z.number().int().positive(), waits: z.string().optional(), group: z.string().optional() } },
    ({ sessionId, waits, group, ...input }) => attempt(async () => {
      const session = await getSession(repo, sessionId);
      if (!isOperator(repo, session)) throw new TallyError("only an operator session adds milestones");
      const milestone = { ...input, ...(waits === undefined ? {} : { waits }), ...(group === undefined ? {} : { group }) };
      const message = await records.update((ledger) => addMilestone(ledger, milestone, repo.config.stages.map((s) => s.id)));
      return ok(await recorded(repo, message));
    }),
  );
  server.registerTool(
    "task_plan",
    { description: "Plan tasks in a milestone, the close last; the track defaults to the session's.", inputSchema: { sessionId: z.string(), milestone: z.string(), track: z.string().optional(), tasks: z.array(z.string()).min(1) } },
    ({ sessionId, milestone, track, tasks }) => attempt(async () => {
      const session = await getSession(repo, sessionId);
      const scoped = scopedTrack(repo, session, track);
      const message = await records.update((ledger) => plan(ledger, { milestone, track: scoped, tasks }));
      return ok(await recorded(repo, message));
    }),
  );
  server.registerTool(
    "task_claim",
    { description: "Take a planned task of the session's track; the board shows who holds it.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string() } },
    ({ sessionId, milestone, task }) => attempt(async () => ok(await claimTask(repo, await getSession(repo, sessionId), await records.readLedger(), milestone, task))),
  );
  server.registerTool(
    "task_release",
    { description: "Give a claimed task back.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string() } },
    ({ sessionId, milestone, task }) => attempt(async () => ok(await releaseClaim(repo, await getSession(repo, sessionId), milestone, task))),
  );
  server.registerTool(
    "task_wait",
    { description: "Mark a task as waiting on something (another track's task, a question row).", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), what: z.string() } },
    ({ sessionId, milestone, task, what }) => attempt(async () => {
      const session = await getSession(repo, sessionId);
      const ledger = await records.readLedger();
      const track = taskTrack(ledger, milestone, task);
      if (track !== undefined) assertMayWrite(repo, session, track);
      const message = await records.update((current) => wait(current, { milestone, task, what }));
      return ok(await recorded(repo, message));
    }),
  );
  server.registerTool(
    "task_land",
    { description: "Record the commit on main that landed a task (the landing itself is land_run, which can do this for you). Follow-up commits go in `also`. The task's claim is released, whoever holds it; `problem` says when it could not be.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), commit: z.string(), also: z.array(z.string()).optional(), track: z.string().optional() } },
    ({ sessionId, milestone, task, commit, also, track }) => attempt(async () => {
      const session = await getSession(repo, sessionId);
      const { message, ...outcome } = await recordTask(repo, { milestone, task, commit, ...(track === undefined ? {} : { track }), ...(also === undefined ? {} : { also }) }, session);
      return ok({ ...(await recorded(repo, message)), ...outcome });
    }),
  );
  server.registerTool(
    "task_other",
    { description: "Record a commit on main that is no task's (a docs or rules commit).", inputSchema: { sessionId: z.string(), commit: z.string(), note: z.string() } },
    ({ sessionId, commit, note }) => attempt(async () => {
      await getSession(repo, sessionId);
      const message = await records.update((ledger) => other(ledger, { commit, note }, resolve));
      return ok(await recorded(repo, message));
    }),
  );
}
