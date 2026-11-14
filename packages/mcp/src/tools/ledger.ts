import { z } from "zod";
import {
  addMilestone, assertMayPark, assertMayWrite, checkoutLine, checkoutState, assertMilestoneOpen, assertStageOpen, checkLedger, claimTask, collect, commitRecords, deliver, deliverableSchema, entriesAbout, findMilestone, findTask, getSession, isOperator, listClaims,
  listLocks, other, plan, Records, recordTask, recordsWaiting, releaseClaim, removeTask, resolveOnMain, rowsOf, TallyError, unwait, wait, type Ledger, type Repo, type Session,
} from "@tally/core";
import { deferredInput } from "../deferred-input.ts";
import { FIELDS, pickKnown } from "../filters.ts";
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

const SCOPE = z.enum(["all", "mine"]).default("all");

async function own(repo: Repo, sessionId: string | undefined): Promise<Session> {
  if (sessionId === undefined) throw new TallyError("scope 'mine' needs the sessionId");
  return getSession(repo, sessionId);
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
    { description: "The build's status as the board shows it: stages, milestones, tasks, tracks, problems, and the live claims and locks. scope 'mine' keeps the session's track: its rows, their tasks and notes, its branch beside main, its claims. `fields` keeps only those top-level keys.", inputSchema: { scope: SCOPE, fields: FIELDS.describe("the top-level keys to keep, such as rows or claims"), ...WHERE } },
    ({ scope, fields, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const status = await collect(repo, await new Records(repo).readLedger());
      const board = { ...status, claims: await listClaims(repo), locks: await listLocks(repo) };
      if (scope === "all") return ok(pickKnown(board, fields, "the board"));
      const session = await own(repo, sessionId);
      const mine = { ...board, rows: rowsOf(board.rows, session.track), tracks: board.tracks.filter((t) => t.isMain || t.branch === session.branch), claims: board.claims.filter((c) => c.track === session.track) };
      return ok(pickKnown(mine, fields, "the board"));
    }),
  );
  server.registerTool(
    "ledger_check",
    { description: "The commits on main the ledger does not record (`missing`, empty when it covers them all) and the `gaps`, each a sentence: a deliverable no task covers, a wait on a task not in the ledger, a deferred part neither left to a task nor parked, and, where reviews are required, a landed task with no clear review. scope 'mine' (with sessionId) keeps the track's gaps and, when the track has paths, only commits wholly under them (else `note` says so). `checkout`: what is uncommitted in the operator checkout outside the records; `parked`: how many parts are parked.", inputSchema: { scope: SCOPE, ...WHERE } },
    ({ scope, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const track = scope === "all" ? undefined : (await own(repo, sessionId)).track;
      const { check, text } = await checkLedger(repo, await new Records(repo).readLedger(), track);
      const checkout = await checkoutState(repo);
      const line = checkoutLine(repo, checkout);
      return ok({ ...check, recordsWaiting: await recordsWaiting(repo), checkout }, line === undefined ? text : `${text}\n${line}`);
    }),
  );
  server.registerTool(
    "milestone_add",
    { description: "Add an empty milestone to a stage (operator scope). `delivers` lists what it owes, each with an id; ledger_check reports a deliverable no task covers.", inputSchema: { sessionId: z.string(), id: z.string(), stage: z.string(), name: z.string(), track: z.string(), weight: z.number().int().positive(), waits: z.string().optional(), group: z.string().optional(), delivers: z.array(deliverableSchema).optional() } },
    ({ sessionId, waits, group, delivers, ...input }) => inSession(source, sessionId, async (repo, session) => {
      const records = new Records(repo);
      if (!isOperator(repo, session)) throw new TallyError("only an operator session adds milestones");
      await assertStageOpen(repo, input.stage);
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
    { description: "Plan tasks in a milestone, the close last; the track defaults to the session's. A task is its name, or {id, brief?, paths?, covers?}: what to do, the files it should touch, and the ids of the deliverables it covers. Details given for a task the track already planned are set on it.", inputSchema: { sessionId: z.string(), milestone: z.string(), track: z.string().optional(), tasks: z.array(z.union([z.string(), plannedTask])).min(1) } },
    ({ sessionId, milestone, track, tasks }) => inSession(source, sessionId, async (repo, session) => {
      const records = new Records(repo);
      const scoped = scopedTrack(repo, session, track);
      await assertMilestoneOpen(repo, await records.readLedger(), milestone);
      const message = await records.update((ledger) => plan(ledger, { milestone, track: scoped, tasks }));
      return ok(await recorded(repo, message));
    }),
  );
  server.registerTool(
    "task_claim",
    { description: "Take a planned task of the session's track; the board shows who holds it. When the task names paths, the answer carries `entries`: the id, kind and title of each context entry about them (read them with context_get).", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string() } },
    ({ sessionId, milestone, task }) => inSession(source, sessionId, async (repo, session) => {
      const ledger = await new Records(repo).readLedger();
      const claim = await claimTask(repo, session, ledger, milestone, task);
      const entries = await entriesAbout(repo, ledger.milestones.find((one) => one.id === milestone)?.tasks.find((one) => one.id === task)?.paths ?? []);
      return ok(entries.length === 0 ? claim : { ...claim, entries });
    }),
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
    "task_remove",
    {
      description: "Remove a planned task that will not be done (planned by mistake, split, or dropped); a landed task stays as the record of its commit. Refused while another session holds it or a queued landing would record it; your own claim is released. Its run records stay, and the tracks whose tasks wait on it are told. The message says what the removal leaves: a deliverable no task covers, or a deferred part with no task.",
      inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), why: z.string() },
    },
    ({ sessionId, milestone, task, why }) => inSession(source, sessionId, async (repo, session) => {
      const removed = await removeTask(repo, { milestone, task, why }, session);
      return ok({ ...removed, commit: await commitRecords(repo, removed.message) });
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
    { description: "Record the commit on main that landed a task (land_start and land_run can do it for you); follow-up commits go in `also`. The task's claim is released, whoever holds it (`problem` when it could not be). `deferred` lists the parts that did not land, each {what} with `to` (MILESTONE:TASK) or `parked` (an operator session's, or under a decision); until those tasks land the board shows it landed in part. Tasks that waited on this one stop waiting, and the message names them.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), commit: z.string(), also: z.array(z.string()).optional(), track: z.string().optional(), deferred: z.array(deferredInput).optional() } },
    ({ sessionId, milestone, task, commit, also, track, deferred }) => inSession(source, sessionId, async (repo, session) => {
      await assertMayPark(repo, session, deferred ?? []);
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
