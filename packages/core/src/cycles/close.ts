import { mkdir, readdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { commitHeld, landingLockPath, recordsMode } from "../records/commit.ts";
import { readDecisions } from "../records/decisions.ts";
import { readNotes } from "../records/notes.ts";
import { questionId, readQuestions } from "../records/questions.ts";
import type { Ledger } from "../schema/ledger.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { LANDING_RETRIES, LockBusy, withLock } from "../store/lock.ts";
import { Records, assertCurrent, type Repo } from "../store/records.ts";
import { closeOpened } from "../tracks/close.ts";
import { isOpen, isPresent, readTracks } from "../tracks/file.ts";
import { closingPath, cycleDir, readCycles } from "./file.ts";
import { planClose, type CloseInput, type ClosePlan, type Move, type Write } from "./plan.ts";
import { cycleState, isCarried } from "./state.ts";

export interface Parked {
  task: string;
  what: string;
  why: string;
}

export interface CycleClosed {
  cycle: number;
  archived: { milestones: string[]; tasks: number; tracks: string[]; files: number };
  carried: { milestones: string[]; tracks: string[]; notes: number; parked: Parked[]; unbuilt: string[]; openQuestions: string[] };
  tracksClosed: string[];
  commit: string | null;
  next: number;
}

const MOST_TEXT = 500;
const QUICK = { retries: 2, minTimeout: 50, maxTimeout: 100 };
const UNBUILT: readonly string[] = ["decided, not built", "partly built"];

const planSchema = z.looseObject({
  schema: z.literal(1),
  n: z.number().int().positive(),
  writes: z.array(z.object({ path: z.string(), contents: z.unknown() })),
  moves: z.array(z.object({ from: z.string(), to: z.string() })),
  last: z.object({ path: z.string(), contents: z.unknown() }),
});

function bounded(what: string, text: string | undefined, least: number): string | undefined {
  const value = text?.trim();
  if (value === undefined && least === 0) return undefined;
  if (value === undefined || value.length < Math.max(least, 1)) throw new TallyError(`closing a cycle needs ${what}`);
  if (value.length > MOST_TEXT) throw new TallyError(`${what} holds at most ${MOST_TEXT} characters; this one has ${value.length}`);
  return value;
}

function checkedInput(input: CloseInput): CloseInput {
  const summary = bounded("a summary", input.summary, 1) ?? "";
  const said = bounded("the operator's own words in said", input.said, 1) ?? "";
  const name = bounded("a name", input.name, 0);
  const decision = bounded("a decision", input.decision, 0);
  return { summary, said, ...(name === undefined ? {} : { name }), ...(decision === undefined ? {} : { decision }) };
}

async function written(recordsDir: string, write: Write): Promise<void> {
  await writeJsonAtomic(join(recordsDir, write.path), write.contents);
}

async function moved(recordsDir: string, move: Move): Promise<void> {
  const from = join(recordsDir, move.from);
  if (!(await isPresent(from))) return;
  await mkdir(dirname(join(recordsDir, move.to)), { recursive: true });
  await rename(from, join(recordsDir, move.to));
}

export async function carryOut(repo: Repo, plan: ClosePlan, steps = Number.POSITIVE_INFINITY): Promise<void> {
  const operations = [...plan.writes.map((write) => () => written(repo.recordsDir, write)), ...plan.moves.map((move) => () => moved(repo.recordsDir, move)), () => written(repo.recordsDir, plan.last)];
  for (const operation of operations.slice(0, steps)) await operation();
}

async function committed(repo: Repo, plan: ClosePlan, summary: string): Promise<string | null> {
  await rm(closingPath(repo.recordsDir, plan.n), { force: true });
  if (recordsMode(repo.config) === "never") return null;
  return (await commitHeld(repo, () => `cycle ${plan.n} closed`, summary)).commit;
}

async function pendingPlan(repo: Repo): Promise<ClosePlan | undefined> {
  const current = (await readCycles(repo.recordsDir)).current;
  for (const n of [current, current - 1].filter((one) => one >= 1)) {
    const path = closingPath(repo.recordsDir, n);
    if (await isPresent(path)) return readJson(path, planSchema) as Promise<ClosePlan>;
  }
  return undefined;
}

export async function finishPendingClose(repo: Repo, retries = QUICK): Promise<string | null | undefined> {
  if (repo.cycle !== undefined || (await pendingPlan(repo)) === undefined) return undefined;
  try {
    return await withLock(landingLockPath(repo), async () => {
      const plan = await pendingPlan(repo);
      if (plan === undefined) return undefined;
      await carryOut(repo, plan);
      const summary = (plan.last.contents as { cycles: { summary: string }[] }).cycles.at(-1)?.summary ?? "";
      return committed(repo, plan, summary);
    }, retries);
  } catch (error: unknown) {
    if (error instanceof LockBusy) return undefined;
    throw error;
  }
}

async function filesUnder(folder: string): Promise<number> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) count += entry.isDirectory() ? await filesUnder(join(folder, entry.name)) : 1;
  return count;
}

const parkedOf = (ledger: Ledger): Parked[] => ledger.milestones.filter((one) => !isCarried(one)).flatMap((milestone) => milestone.tasks.flatMap((task) =>
  (task.deferred ?? []).flatMap((part) => (part.parked === undefined ? [] : [{ task: `${milestone.id}:${task.id}`, what: part.what, why: part.parked.why }]))));

async function answered(repo: Repo, n: number, ledger: Ledger, tracksClosed: string[]): Promise<CycleClosed> {
  const archived = ledger.milestones.filter((one) => !isCarried(one));
  const tracks = await readTracks(repo.recordsDir);
  const archivedTracks = await readTracks(cycleDir(repo.recordsDir, n));
  const decisions = await readDecisions(repo);
  const questions = await readQuestions(repo);
  return {
    cycle: n,
    archived: { milestones: archived.map((one) => one.id), tasks: archived.reduce((sum, one) => sum + one.tasks.length, 0), tracks: archivedTracks.tracks.map((track) => track.name), files: await filesUnder(cycleDir(repo.recordsDir, n)) },
    carried: {
      milestones: ledger.milestones.filter(isCarried).map((one) => one.id),
      tracks: tracks.tracks.filter(isOpen).map((track) => track.name),
      notes: (await readNotes(repo)).notes.length,
      parked: parkedOf(ledger),
      unbuilt: decisions.decisions.filter((one) => UNBUILT.includes(one.state)).map((one) => one.id),
      openQuestions: (questions?.open ?? []).map((one) => questionId(one.row)),
    },
    tracksClosed,
    commit: null,
    next: n + 1,
  };
}

const refusal = (n: number, blockers: readonly string[]): TallyError =>
  new TallyError(`cycle ${n} cannot close: ${blockers[0] ?? ""}${blockers.length > 1 ? `; ${blockers.length - 1} more stop it, and cycle_list names them` : ""}`);

export async function closeCycle(repo: Repo, session: Session, input: CloseInput, now = new Date()): Promise<CycleClosed> {
  assertCurrent(repo);
  if (!isOperator(repo, session)) throw new TallyError("only an operator session closes a cycle, on the operator's word; a track that wants one closed asks with question_add");
  const checked = checkedInput(input);
  await finishPendingClose(repo, LANDING_RETRIES);
  const by = { track: session.track, agent: session.agent };
  return withLock(landingLockPath(repo), async () => {
    const ledger = await new Records(repo).readLedger();
    const n = (await readCycles(repo.recordsDir)).current;
    const state = await cycleState(repo, ledger, n);
    if (state.blockers.length > 0) throw refusal(n, state.blockers);
    for (const name of state.tracksToClose) await closeOpened(repo, name, { by, now, why: `cycle ${n} closed`, commit: false });
    const plan = await planClose(repo, { by, now, input: checked });
    await writeJsonAtomic(closingPath(repo.recordsDir, n), plan);
    await carryOut(repo, plan);
    const answer = await answered(repo, n, ledger, state.tracksToClose);
    return { ...answer, commit: await committed(repo, plan, checked.summary) };
  }, LANDING_RETRIES);
}
