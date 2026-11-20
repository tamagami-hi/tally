import { join } from "node:path";
import { readEntries, type Entry } from "../context/entries.ts";
import { cycleDir, readCycles } from "../cycles/file.ts";
import { TallyError, namedList } from "../errors.ts";
import { ledgerSchema, type Ledger } from "../schema/ledger.ts";
import type { Review } from "../schema/reviews.ts";
import { readJson, tolerated } from "../store/json.ts";
import { Records, type Repo } from "../store/records.ts";
import { isPresent } from "../tracks/file.ts";
import { UNBUILT_STATES, readDecisions, type Decision, type DecisionState } from "./decisions.ts";
import { readNotes, type Note } from "./notes.ts";
import { questionId, readQuestions, type AnsweredQuestion, type Question } from "./questions.ts";
import { readReviews } from "./reviews.ts";

export { checkedAccept } from "./accept.ts";

export type Cited =
  | { kind: "decision"; id: string; record: Decision }
  | { kind: "entry"; id: string; record: Entry }
  | { kind: "question"; id: string; record: Question | AnsweredQuestion }
  | { kind: "note"; id: string; record: Note; cycle?: number }
  | { kind: "review"; id: string; record: Review; cycle?: number };

export interface Lookup {
  found: Cited[];
  unknown: string[];
  problems: string[];
}

export interface ToMark {
  id: string;
  group: string;
  state: DecisionState;
  tasks: string[];
}

interface Held {
  decisions: Decision[];
  entries: Entry[];
  questions: (Question | AnsweredQuestion)[];
  notes: Note[];
  reviews: Review[];
}

const NO_ENTRIES: Entry[] = [];

interface Read<T> {
  value: T;
  problems: string[];
}

async function kept<T>(reading: Promise<T>, empty: T): Promise<Read<T>> {
  const read = await tolerated(reading, empty);
  return { value: read.value, problems: read.problem === undefined ? [] : [read.problem] };
}

async function heldIn(repo: Repo): Promise<Read<Held>> {
  const questions = await kept(readQuestions(repo), null);
  const decisions = await kept(readDecisions(repo), { schema: 1, decisions: [], replaced: [] });
  const entries = await kept(readEntries(repo), NO_ENTRIES);
  const notes = await kept(readNotes(repo), { schema: 1, nextNumber: 1, notes: [] });
  const reviews = await kept(readReviews(repo), { schema: 1, nextId: 1, reviews: [] });
  return {
    value: { decisions: decisions.value.decisions, entries: entries.value, questions: [...(questions.value?.open ?? []), ...(questions.value?.answered ?? [])], notes: notes.value.notes, reviews: reviews.value.reviews },
    problems: [...questions.problems, ...decisions.problems, ...entries.problems, ...notes.problems, ...reviews.problems],
  };
}

async function archivedIn(repo: Repo, n: number): Promise<Read<Pick<Held, "notes" | "reviews">>> {
  const folder = { ...repo, recordsDir: cycleDir(repo.recordsDir, n), cycle: n };
  const notes = await kept(readNotes(folder), { schema: 1, nextNumber: 1, notes: [] });
  const reviews = await kept(readReviews(folder), { schema: 1, nextId: 1, reviews: [] });
  return { value: { notes: notes.value.notes, reviews: reviews.value.reviews }, problems: [...notes.problems, ...reviews.problems] };
}

function inHeld(held: Held, id: string): Cited[] {
  return [
    ...held.decisions.filter((one) => one.id === id).map((record): Cited => ({ kind: "decision", id, record })),
    ...held.entries.filter((one) => one.id === id).map((record): Cited => ({ kind: "entry", id, record })),
    ...held.questions.filter((one) => questionId(one.row) === id).map((record): Cited => ({ kind: "question", id, record })),
    ...held.notes.filter((one) => one.id === id).map((record): Cited => ({ kind: "note", id, record })),
    ...held.reviews.filter((one) => one.id === id).map((record): Cited => ({ kind: "review", id, record })),
  ];
}

function inArchive(held: Pick<Held, "notes" | "reviews">, id: string, cycle: number): Cited[] {
  return [
    ...held.notes.filter((one) => one.id === id).map((record): Cited => ({ kind: "note", id, record, cycle })),
    ...held.reviews.filter((one) => one.id === id).map((record): Cited => ({ kind: "review", id, record, cycle })),
  ];
}

async function closedCycles(repo: Repo): Promise<Read<number[]>> {
  const read = await kept(readCycles(repo.recordsDir), { schema: 1, current: 1, cycles: [] });
  return { value: read.value.cycles.map((one) => one.n).sort((a, b) => b - a), problems: read.problems };
}

export async function findCited(repo: Repo, ids: readonly string[]): Promise<Lookup> {
  const wanted = [...new Set(ids)];
  const current = await heldIn(repo);
  const here = wanted.map((id) => ({ id, found: inHeld(current.value, id) }));
  const missing = here.filter((one) => one.found.length === 0).map((one) => one.id);
  const cycles = missing.length === 0 ? { value: [], problems: [] } : await closedCycles(repo);
  const archives = await Promise.all(cycles.value.map(async (n) => ({ n, read: await archivedIn(repo, n) })));
  const resolved = here.map((one) => (one.found.length > 0 ? one : { id: one.id, found: archives.map(({ n, read }) => inArchive(read.value, one.id, n)).find((list) => list.length > 0) ?? [] }));
  const problems = [...current.problems, ...cycles.problems, ...archives.flatMap(({ read }) => read.problems)];
  return { found: resolved.flatMap((one) => one.found), unknown: resolved.filter((one) => one.found.length === 0).map((one) => one.id), problems };
}

export async function assertCited(repo: Repo, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const { unknown, problems } = await findCited(repo, ids);
  if (unknown.length === 0) return;
  const unread = problems.length === 0 ? "" : `; and some records could not be read: ${problems.join("; ")}`;
  throw new TallyError(`no record has the id ${namedList(unknown)}; a task cites a decision, a context entry, a question, a note or a review by its id${unread}`);
}

export interface ClosedLedgers {
  ledgers: Ledger[];
  problems: string[];
}

export async function closedLedgers(repo: Repo): Promise<ClosedLedgers> {
  const cycles = await closedCycles(repo);
  const read = await Promise.all(cycles.value.map(async (n) => {
    const path = join(cycleDir(repo.recordsDir, n), "ledger.json");
    return (await isPresent(path)) ? [await tolerated(readJson(path, ledgerSchema), undefined)] : [];
  }));
  const found = read.flat();
  return { ledgers: found.flatMap((one) => (one.value === undefined ? [] : [one.value])), problems: [...cycles.problems, ...found.flatMap((one) => (one.problem === undefined ? [] : [one.problem]))] };
}

export interface Marking {
  toMark: ToMark[];
  problems: string[];
}

export async function decisionsToMark(repo: Repo, current?: Ledger): Promise<Marking> {
  const decisions = await tolerated(readDecisions(repo), { schema: 1 as const, decisions: [], replaced: [] });
  const decided = decisions.problem === undefined ? [] : [decisions.problem];
  const unbuilt = decisions.value.decisions.filter((one) => UNBUILT_STATES.includes(one.state));
  if (unbuilt.length === 0) return { toMark: [], problems: decided };
  const closed = await closedLedgers(repo);
  const ledgers = [current ?? (await new Records(repo).readLedger()), ...closed.ledgers];
  const citing = ledgers.flatMap((ledger) => ledger.milestones.flatMap((milestone) => milestone.tasks.map((task) => ({ ref: `${milestone.id}:${task.id}`, landed: task.status === "landed", cites: task.cites ?? [] }))));
  const toMark = unbuilt.flatMap((decision): ToMark[] => {
    const tasks = citing.filter((task) => task.cites.includes(decision.id));
    return tasks.length > 0 && tasks.every((task) => task.landed) ? [{ id: decision.id, group: decision.group, state: decision.state, tasks: tasks.map((task) => task.ref) }] : [];
  });
  return { toMark, problems: [...decided, ...closed.problems] };
}
