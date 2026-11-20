import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { ACTIVITY_DIR } from "../records/activity.ts";
import { readAllEvidence } from "../records/evidence.ts";
import { readNotes } from "../records/notes.ts";
import { readReviews } from "../records/reviews.ts";
import { readPhases } from "../phases/file.ts";
import { ledgerSchema, type Ledger } from "../schema/ledger.ts";
import { readJson } from "../store/json.ts";
import { Records, type Repo } from "../store/records.ts";
import { readTracks, isPresent } from "../tracks/file.ts";
import { cycleDir, readCycles, type CycleRecord } from "./file.ts";
import { askOf, cycleComplete, cycleState, isCarried } from "./state.ts";
import { cycleView } from "./view.ts";
import type { Parked } from "./close.ts";

export const DEFAULT_CYCLES = 20;

export interface CurrentCycle {
  n: number;
  since?: string;
  milestones: { open: number; finished: number; carried: number };
  tasks: { landed: number; total: number };
  complete: boolean;
  blockers: string[];
  ask?: string;
}

export type ClosedCycle = Pick<CycleRecord, "n" | "name" | "closedAt" | "closedBy" | "summary" | "from" | "to"> & { milestones: number; tasks: number };

export interface CycleList {
  current: CurrentCycle;
  closed: ClosedCycle[];
  matched: number;
}

export interface CycleTotals {
  phases: number;
  milestones: number;
  tasks: number;
  tracks: number;
  runs: number;
  reviews: number;
  notes: number;
  days: number;
}

const tasksIn = (ledger: Ledger): number => ledger.milestones.reduce((sum, one) => sum + one.tasks.length, 0);

const landedIn = (ledger: Ledger): number => ledger.milestones.reduce((sum, one) => sum + one.tasks.filter((task) => task.status === "landed").length, 0);

async function closedLedger(repo: Repo, n: number): Promise<Ledger | undefined> {
  const path = join(cycleDir(repo.recordsDir, n), "ledger.json");
  return (await isPresent(path)) ? readJson(path, ledgerSchema) : undefined;
}

export const isComplete = (repo: Repo, ledger: Ledger, n: number): Promise<boolean> => cycleComplete(repo, ledger, n);

async function current(repo: Repo, n: number, since: string | undefined): Promise<CurrentCycle> {
  const ledger = await new Records(repo).readLedger();
  const state = await cycleState(repo, ledger, n);
  const complete = state.blockers.length === 0;
  return {
    n,
    ...(since === undefined ? {} : { since }),
    milestones: { open: ledger.milestones.length - state.finished.length, finished: state.finished.length, carried: state.carried.length },
    tasks: { landed: landedIn(ledger), total: tasksIn(ledger) },
    complete,
    blockers: state.blockers,
    ...(complete ? { ask: askOf(n) } : {}),
  };
}

export async function cycleList(repo: Repo, asked: { limit?: number | undefined }): Promise<CycleList> {
  const file = await readCycles(repo.recordsDir);
  const newest = [...file.cycles].reverse();
  const closed: ClosedCycle[] = [];
  for (const cycle of newest.slice(0, asked.limit ?? DEFAULT_CYCLES)) {
    const ledger = await closedLedger(repo, cycle.n);
    const { n, name, closedAt, closedBy, summary, from, to } = cycle;
    closed.push({ n, ...(name === undefined ? {} : { name }), closedAt, closedBy, summary, from, to, milestones: ledger?.milestones.length ?? 0, tasks: ledger === undefined ? 0 : tasksIn(ledger) });
  }
  return { current: await current(repo, file.current, newest[0]?.closedAt), closed, matched: file.cycles.length };
}

async function count(folder: string): Promise<number> {
  return (await readdir(folder).catch(() => [])).filter((name) => name.endsWith(".json")).length;
}

const parkedIn = (ledger: Ledger): Parked[] => ledger.milestones.filter((one) => !isCarried(one)).flatMap((milestone) => milestone.tasks.flatMap((task) =>
  (task.deferred ?? []).flatMap((part) => (part.parked === undefined ? [] : [{ task: `${milestone.id}:${task.id}`, what: part.what, why: part.parked.why }]))));

export async function cycleOne(repo: Repo, n: number): Promise<CycleRecord & { totals: CycleTotals; parked: Parked[] }> {
  const view = await cycleView(repo, n);
  const record = (await readCycles(repo.recordsDir)).cycles.find((cycle) => cycle.n === n);
  const ledger = await new Records(view).readLedger();
  const totals: CycleTotals = {
    phases: (await readPhases(view.recordsDir)).phases.length,
    milestones: ledger.milestones.length,
    tasks: tasksIn(ledger),
    tracks: (await readTracks(view.recordsDir)).tracks.length,
    runs: (await readAllEvidence(view)).reduce((sum, one) => sum + one.records.length, 0),
    reviews: (await readReviews(view)).reviews.length,
    notes: (await readNotes(view)).notes.length,
    days: await count(join(view.recordsDir, ACTIVITY_DIR)),
  };
  return { ...(record as CycleRecord), totals, parked: parkedIn(ledger) };
}
