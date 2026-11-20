import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { landingLockPath } from "../records/commit.ts";
import { readDecisions } from "../records/decisions.ts";
import { readNotes } from "../records/notes.ts";
import { questionId, readQuestions } from "../records/questions.ts";
import type { Ledger } from "../schema/ledger.ts";
import { tracksFileSchema } from "../schema/tracks.ts";
import { clearRest } from "../state/rest.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { writeJsonAtomic } from "../store/json.ts";
import { LANDING_RETRIES, LockBusy, RETRIES, withLock, withLocks, type Retries } from "../store/lock.ts";
import { Records, assertCurrent, type Repo } from "../store/records.ts";
import { closedIn } from "../tracks/close.ts";
import { isOpen, isPresent, readTracks, tracksPath } from "../tracks/file.ts";
import { assertReadable, carryOut, ledgerLock, moveLocks, recordLocks } from "./carry.ts";
import { closingPath, cycleDir, readCycles } from "./file.ts";
import { committed, finishHeld } from "./finish.ts";
import { archivedIds, closedNames, movesOf, planClose, type CloseInput, type ClosePlan, type Move } from "./plan.ts";
import { cycleState, isCarried, type CycleState } from "./state.ts";

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
  keptMoved?: string[];
  commit: string | null;
  next: number;
}

interface Closing {
  n: number;
  by: { track: string; agent: string };
  now: Date;
  input: CloseInput;
  retries: Retries;
}

interface Read {
  ledger: Ledger;
  state: CycleState;
  unbuilt: string[];
  openQuestions: string[];
  tracks: string[];
  moves: Move[];
}

const MOST_TEXT = 500;
const UNBUILT: readonly string[] = ["decided, not built", "partly built"];

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

async function filesUnder(folder: string): Promise<number> {
  const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
  let count = 0;
  for (const entry of entries) count += entry.isDirectory() ? await filesUnder(join(folder, entry.name)) : 1;
  return count;
}

const parkedOf = (ledger: Ledger): Parked[] => ledger.milestones.filter((one) => !isCarried(one)).flatMap((milestone) => milestone.tasks.flatMap((task) =>
  (task.deferred ?? []).flatMap((part) => (part.parked === undefined ? [] : [{ task: `${milestone.id}:${task.id}`, what: part.what, why: part.parked.why }]))));

const refusal = (n: number, blockers: readonly string[]): TallyError =>
  new TallyError(`cycle ${n} cannot close: ${blockers[0] ?? ""}${blockers.length > 1 ? `; ${blockers.length - 1} more stop it, and cycle_list names them` : ""}`);

async function taking<T>(n: number, paths: readonly string[], retries: Retries, body: () => Promise<T>): Promise<T> {
  let entered = false;
  try {
    return await withLocks(paths, () => {
      entered = true;
      return body();
    }, retries);
  } catch (error: unknown) {
    if (!entered && error instanceof LockBusy) throw new TallyError(`cycle ${n} was not closed: ${error.message}`);
    throw error;
  }
}

async function closeTracks(repo: Repo, closing: Closing, names: readonly string[]): Promise<string[]> {
  for (const name of names) {
    const { file } = await closedIn(repo, await readTracks(repo.recordsDir), name, { by: closing.by, now: closing.now, why: `cycle ${closing.n} closed` });
    await writeJsonAtomic(tracksPath(repo.recordsDir), tracksFileSchema.parse(file));
    await clearRest(repo, name);
  }
  return [...names];
}

async function answerOf(repo: Repo, plan: ClosePlan, read: Read, tracksClosed: string[]): Promise<CycleClosed> {
  const archived = read.ledger.milestones.filter((one) => plan.milestones.includes(one.id));
  const kept = (await readNotes(repo)).notes.filter((note) => !plan.notes.includes(note.id)).length;
  return {
    cycle: plan.n,
    archived: { milestones: plan.milestones, tasks: archived.reduce((sum, one) => sum + one.tasks.length, 0), tracks: plan.tracks, files: 0 },
    carried: {
      milestones: read.ledger.milestones.filter(isCarried).map((one) => one.id),
      tracks: (await readTracks(repo.recordsDir)).tracks.filter(isOpen).map((track) => track.name),
      notes: kept + 1,
      parked: parkedOf(read.ledger),
      unbuilt: read.unbuilt,
      openQuestions: read.openQuestions,
    },
    tracksClosed,
    commit: null,
    next: plan.n + 1,
  };
}

async function readableFor(repo: Repo, n: number | undefined): Promise<void> {
  try {
    await assertReadable(repo);
  } catch (error: unknown) {
    throw new TallyError(`${n === undefined ? "the cycle" : `cycle ${n}`} was not closed: ${messageOf(error)}; nothing was written: mend that file and call again`);
  }
}

async function carried(repo: Repo, closing: Closing, read: Read): Promise<CycleClosed> {
  await readableFor(repo, closing.n);
  const tracksClosed = await closeTracks(repo, closing, read.state.tracksToClose);
  const plan = await planClose(repo, read.ledger, { by: closing.by, now: closing.now, input: closing.input, tracks: read.tracks, moves: read.moves });
  const answer = await answerOf(repo, plan, read, tracksClosed);
  await writeJsonAtomic(closingPath(repo.recordsDir, plan.n), plan);
  await carryOut(repo, plan);
  await rm(closingPath(repo.recordsDir, plan.n), { force: true });
  const moved = await movedKept(repo, plan);
  return moved.length === 0 ? answer : { ...answer, keptMoved: moved };
}

async function movedKept(repo: Repo, plan: ClosePlan): Promise<string[]> {
  const moves = plan.kept ?? [];
  const there = await Promise.all(moves.map((move) => isPresent(join(repo.root, move.to))));
  return moves.filter((_, index) => there[index] === true).map((move) => move.to);
}

async function readFor(repo: Repo, n: number): Promise<Read> {
  await readableFor(repo, n);
  const ledger = await new Records(repo).readLedger();
  const state = await cycleState(repo, ledger, n);
  if (state.blockers.length > 0) throw refusal(n, state.blockers);
  const decisions = await readDecisions(repo);
  const questions = await readQuestions(repo);
  const tracks = [...new Set([...closedNames(await readTracks(repo.recordsDir)), ...state.tracksToClose])];
  return {
    ledger,
    state,
    unbuilt: decisions.decisions.filter((one) => UNBUILT.includes(one.state)).map((one) => one.id),
    openQuestions: (questions?.open ?? []).map((one) => questionId(one.row)),
    tracks,
    moves: await movesOf(repo, n, archivedIds(ledger), tracks, state.tracksToClose),
  };
}

async function closedHeld(repo: Repo, closing: Closing): Promise<CycleClosed> {
  return taking(closing.n, [ledgerLock(repo)], closing.retries, async () => {
    const read = await readFor(repo, closing.n);
    return taking(closing.n, [...recordLocks(repo), ...moveLocks(repo, read.moves)], closing.retries, () => carried(repo, closing, read));
  });
}

export async function closeCycle(repo: Repo, session: Session, input: CloseInput, now = new Date(), retries: Retries = RETRIES): Promise<CycleClosed> {
  assertCurrent(repo);
  if (!isOperator(repo, session)) throw new TallyError("only an operator session closes a cycle, on the operator's word; a track that wants one closed asks with question_add");
  const checked = checkedInput(input);
  const by = { track: session.track, agent: session.agent };
  return withLock(landingLockPath(repo), async () => {
    await finishHeld(repo, retries);
    await readableFor(repo, undefined);
    const n = (await readCycles(repo.recordsDir)).current;
    const answer = await closedHeld(repo, { n, by, now, input: checked, retries });
    const commit = await committed(repo, n, checked.summary);
    return { ...answer, archived: { ...answer.archived, files: await filesUnder(cycleDir(repo.recordsDir, n)) }, commit };
  }, LANDING_RETRIES);
}
