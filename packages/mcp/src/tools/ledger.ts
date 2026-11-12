import { z } from "zod";
import {
  COVERED, Records, TallyError, addMilestone, assertMayWrite, claimTask, collect, commitRecords, deferredSchema, deliver, deliverableSchema, findMilestone, findTask, getSession, isOperator,
  listClaims, listLocks, logLines, other, plan, recordTask, releaseClaim, resolveOnMain, rowsOf, unrecorded, unwait, wait, type Ledger, type Repo, type Session,
} from "@tally/core";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

async function recorded(repo: Repo, message: string): Promise<{ message: string; commit: string | null }> {
  return { message, commit: await commitRecords(repo, message) };
}

function assertMayWriteTask(repo: Repo, session: Session, ledger: Ledger, milestone: string, task: string): void {
  const track = findTask(findMilestone(ledger, milestone), task)?.track;
  if (track !== undefined) assertMayWrite(repo, session, track);
}

function scopedTrack(repo: Repo, session: Session, given: string | undefined): string {
  const track = given ?? session.track;
  assertMayWrite(repo, session, track);
  return track;
}

const plannedTask = z.object({
  id: z.string().min(1),
  brief: z.string().optional().describe("what to do"),
  paths: z.array(z.string().min(1)).optional().describe("the files it expects to touch"),
  covers: z.array(z.string().min(1)).optional().describe("ids of the milestone's deliverables it covers"),
});

export function registerLedgerTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "board_get",
    { description: "The build's status as the board shows it: stages, milestones, tasks, tracks, problems, plus the live claims and locks. scope 'mine' keeps only the session's track: its rows, their tasks and notes, its branch and its claims.", inputSchema: { scope: z.enum(["all", "mine"]).default("all"), ...WHERE } },
    ({ scope, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const status = await collect(repo, await new Records(repo).readLedger());
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
    { description: "The commits on main the ledger does not account for; empty when every commit is recorded.", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const ledger = await new Records(repo).readLedger();
      const missing = unrecorded(ledger, await logLines(repo.root, `${ledger.baseline}..${repo.config.mainBranch}`), repo.config.records.commitPrefix);
      return ok({ missing, covered: missing.length === 0 }, missing.length === 0 ? COVERED : missing.join("\n"));
    }),
  );
  server.registerTool(
    "milestone_add",
    { description: "Add an empty milestone to a stage (operator scope). `delivers` lists what it owes, each with an id; ledger_check reports a deliverable no task covers.", inputSchema: { sessionId: z.string(), id: z.string(), stage: z.string(), name: z.string(), track: z.string(), weight: z.number().int().positive(), waits: z.string().optional(), group: z.string().optional(), delivers: z.array(deliverableSchema).optional() } },
    ({ sessionId, waits, group, delivers, ...input }) => inSession(source, sessionId, async (repo, session) => {
      const records = new Records(repo);
      if (!isOperator(repo, session)) throw new TallyError("only an operator session adds milestones");
      const milestone = { ...input, delivers, ...(waits === undefined ? {} : { waits }), ...(group === undefined ? {} : { group }) };
      const message = await records.update((ledger) => addMilestone(ledger, milestone, repo.config.stages.map((s) => s.id)));
      return ok(await recorded(repo, message));
    }),
  );
  server.registerTool(
    "milestone_deliver",
    { description: "Add deliverables to a milestone that exists (operator scope): what it owes, each with an id that tasks name in `covers`. An id the milestone already has is refused.", inputSchema: { sessionId: z.string(), milestone: z.string(), delivers: z.array(deliverableSchema).min(1) } },
    ({ sessionId, milestone, delivers }) => inSession(source, sessionId, async (repo, session) => {
      if (!isOperator(repo, session)) throw new TallyError("only an operator session adds deliverables to a milestone");
      const message = await new Records(repo).update((ledger) => deliver(ledger, { milestone, delivers }));
      return ok(await recorded(repo, message));
    }),
  );
  server.registerTool(
    "task_plan",
    { description: "Plan tasks in a milestone, the close last; the track defaults to the session's. A task is its name, or {id, brief?, paths?, covers?}: what to do, the files it expects to touch, and the ids of the milestone's deliverables it covers. Details given for a task the track already planned are set on it.", inputSchema: { sessionId: z.string(), milestone: z.string(), track: z.string().optional(), tasks: z.array(z.union([z.string(), plannedTask])).min(1) } },
    ({ sessionId, milestone, track, tasks }) => inSession(source, sessionId, async (repo, session) => {
      const records = new Records(repo);
      const scoped = scopedTrack(repo, session, track);
      const message = await records.update((ledger) => plan(ledger, { milestone, track: scoped, tasks }));
      return ok(await recorded(repo, message));
    }),
  );
  server.registerTool(
    "task_claim",
    { description: "Take a planned task of the session's track; the board shows who holds it.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string() } },
    ({ sessionId, milestone, task }) => inSession(source, sessionId, async (repo, session) => ok(await claimTask(repo, session, await new Records(repo).readLedger(), milestone, task))),
  );
  server.registerTool(
    "task_release",
    { description: "Give a claimed task back.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string() } },
    ({ sessionId, milestone, task }) => inSession(source, sessionId, async (repo, session) => ok(await releaseClaim(repo, session, milestone, task))),
  );
  server.registerTool(
    "task_wait",
    { description: "Mark a task as waiting on something (another track's task, a question row). With `on`, it waits on that task, and the wait clears itself when the task lands; a task not planned yet is accepted, and ledger_check reports it.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), what: z.string(), on: z.string().optional().describe("the task it waits on, as MILESTONE:TASK") } },
    ({ sessionId, milestone, task, what, on }) => inSession(source, sessionId, async (repo, session) => {
      const records = new Records(repo);
      assertMayWriteTask(repo, session, await records.readLedger(), milestone, task);
      const message = await records.update((current) => wait(current, { milestone, task, what, on }));
      return ok(await recorded(repo, message));
    }),
  );
  server.registerTool(
    "task_unwait",
    { description: "Clear a task's waits, the free-text one and every task it waits on, so the board shows it as ready again.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string() } },
    ({ sessionId, milestone, task }) => inSession(source, sessionId, async (repo, session) => {
      const records = new Records(repo);
      assertMayWriteTask(repo, session, await records.readLedger(), milestone, task);
      const message = await records.update((current) => unwait(current, { milestone, task }));
      return ok(await recorded(repo, message));
    }),
  );
  server.registerTool(
    "task_land",
    { description: "Record the commit on main that landed a task (the landing itself is land_run, which can do this for you). Follow-up commits go in `also`. The task's claim is released, whoever holds it; `problem` says when it could not be. `deferred` lists the parts that did not land, each {what, to?} with `to` the MILESTONE:TASK that will finish it: the board shows the task as landed in part until those tasks land. Tasks that waited on this one stop waiting, and the message names them.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), commit: z.string(), also: z.array(z.string()).optional(), track: z.string().optional(), deferred: z.array(deferredSchema).optional() } },
    ({ sessionId, milestone, task, commit, also, track, deferred }) => inSession(source, sessionId, async (repo, session) => {
      const { message, ...outcome } = await recordTask(repo, { milestone, task, commit, deferred, ...(track === undefined ? {} : { track }), ...(also === undefined ? {} : { also }) }, session);
      return ok({ ...(await recorded(repo, message)), ...outcome });
    }),
  );
  server.registerTool(
    "task_other",
    { description: "Record a commit on main that is no task's (a docs or rules commit).", inputSchema: { sessionId: z.string(), commit: z.string(), note: z.string() } },
    ({ sessionId, commit, note }) => inSession(source, sessionId, async (repo) => {
      const records = new Records(repo);
      const message = await records.update((ledger) => other(ledger, { commit, note }, resolveOnMain(repo.root, repo.config.mainBranch)));
      return ok(await recorded(repo, message));
    }),
  );
}
