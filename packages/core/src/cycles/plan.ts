import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gitMust } from "../git/run.ts";
import { phaseRows, isClosed } from "../phases/rows.ts";
import { ACTIVITY_DIR } from "../records/activity.ts";
import { readBuildlog } from "../records/buildlog.ts";
import { readNotes, type Note } from "../records/notes.ts";
import { readReviews } from "../records/reviews.ts";
import { TALLY } from "../records/tell.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { PhaseRecord } from "../schema/phases.ts";
import { readPhases } from "../phases/file.ts";
import { Records, type Repo } from "../store/records.ts";
import { isOpen, isPresent, readTracks } from "../tracks/file.ts";
import { CYCLES_DIR, readCycles, type CycleRecord } from "./file.ts";
import { isCarried } from "./state.ts";

export interface Move {
  from: string;
  to: string;
}

export interface Write {
  path: string;
  contents: unknown;
}

export interface ClosePlan {
  schema: 1;
  n: number;
  writes: Write[];
  moves: Move[];
  last: Write;
}

export interface CloseInput {
  summary: string;
  said: string;
  name?: string | undefined;
  decision?: string | undefined;
}

interface Split {
  archived: ReadonlySet<string>;
  closedTracks: ReadonlySet<string>;
}

const SHORT = 7;

const inCycle = (n: number, path: string): string => join(CYCLES_DIR, `cycle-${n}`, path);

async function filesIn(dir: string): Promise<string[]> {
  return (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".json")).sort();
}

async function ledgerWrites(n: number, ledger: Ledger, tip: string): Promise<Write[]> {
  const kept = ledger.milestones.filter(isCarried);
  const archived = ledger.milestones.filter((milestone) => !isCarried(milestone));
  return [
    { path: inCycle(n, "ledger.json"), contents: { ...ledger, milestones: archived } },
    { path: "ledger.json", contents: { ...ledger, baseline: tip, other: [], milestones: kept } },
  ];
}

async function trackWrites(repo: Repo, n: number): Promise<Write[]> {
  const file = await readTracks(repo.recordsDir);
  return [
    { path: inCycle(n, "tracks.json"), contents: { ...file, tracks: file.tracks.filter((track) => !isOpen(track)) } },
    { path: "tracks.json", contents: { ...file, tracks: file.tracks.filter(isOpen) } },
  ];
}

async function phaseWrites(repo: Repo, n: number, ledger: Ledger, split: Split, closing: Pick<PhaseRecord, "closedAt" | "closedBy" | "commit">): Promise<Write[]> {
  const file = await readPhases(repo.recordsDir);
  const rows = await phaseRows(repo);
  const stages = new Map(ledger.milestones.map((milestone) => [milestone.stage, [] as string[]]));
  for (const milestone of ledger.milestones) stages.get(milestone.stage)?.push(milestone.id);
  const closes = (id: string): boolean => {
    const ids = stages.get(id) ?? [];
    return ids.length > 0 && ids.every((one) => split.archived.has(one));
  };
  const toClose = rows.filter((row) => !isClosed(row) && closes(row.id)).map((row) => row.id);
  const held = new Map(file.phases.map((phase) => [phase.id, phase]));
  const closed = toClose.map((id): PhaseRecord => ({ ...(held.get(id) ?? { id }), ...closing, summary: `closed with cycle ${n}` }));
  const every = [...file.phases.filter((phase) => !toClose.includes(phase.id)), ...closed];
  const stillOpen = file.phases.filter((phase) => !toClose.includes(phase.id) && phase.closedAt === undefined);
  if (every.length === 0) return [];
  return [{ path: inCycle(n, "phases.json"), contents: { ...file, phases: every } }, { path: "phases.json", contents: { ...file, phases: stillOpen } }];
}

async function reviewWrites(repo: Repo, n: number, split: Split): Promise<Write[]> {
  if (!(await isPresent(join(repo.recordsDir, "reviews.json")))) return [];
  const file = await readReviews(repo);
  return [
    { path: inCycle(n, "reviews.json"), contents: { ...file, reviews: file.reviews.filter((review) => split.archived.has(review.milestone)) } },
    { path: "reviews.json", contents: { ...file, reviews: file.reviews.filter((review) => !split.archived.has(review.milestone)) } },
  ];
}

async function buildlogWrites(repo: Repo, n: number, split: Split): Promise<Write[]> {
  if (!(await isPresent(join(repo.recordsDir, "buildlog.json")))) return [];
  const file = await readBuildlog(repo);
  return [
    { path: inCycle(n, "buildlog.json"), contents: { ...file, entries: file.entries.filter((entry) => split.archived.has(entry.milestone)) } },
    { path: "buildlog.json", contents: { ...file, entries: file.entries.filter((entry) => !split.archived.has(entry.milestone)) } },
  ];
}

const isArchivedNote = (note: Note, closedTracks: ReadonlySet<string>): boolean =>
  note.doneAt !== undefined || note.from.agent === TALLY || (note.to !== "all" && note.to.every((track) => closedTracks.has(track)));

async function noteWrites(repo: Repo, n: number, split: Split, closeNote: (id: string) => Note): Promise<Write[]> {
  const file = await readNotes(repo);
  const note = closeNote(`note-${file.nextNumber}`);
  const archived = file.notes.filter((one) => isArchivedNote(one, split.closedTracks));
  const kept = file.notes.filter((one) => !isArchivedNote(one, split.closedTracks));
  return [
    { path: inCycle(n, "context/notes.json"), contents: { ...file, notes: archived } },
    { path: "context/notes.json", contents: { ...file, nextNumber: file.nextNumber + 1, notes: [...kept, note] } },
  ];
}

async function evidenceMoves(repo: Repo, n: number, split: Split): Promise<Move[]> {
  const dir = join(repo.recordsDir, "evidence");
  const moves: Move[] = [];
  for (const name of await filesIn(dir)) {
    const milestone = (JSON.parse(await readFile(join(dir, name), "utf8")) as { milestone?: string }).milestone;
    if (milestone !== undefined && split.archived.has(milestone)) moves.push({ from: join("evidence", name), to: inCycle(n, join("evidence", name)) });
  }
  return moves;
}

async function handoffMoves(repo: Repo, n: number, split: Split): Promise<Move[]> {
  const dir = join(repo.recordsDir, "handoffs");
  const moves: Move[] = [];
  for (const name of await filesIn(dir)) {
    const track = (JSON.parse(await readFile(join(dir, name), "utf8")) as { track?: string }).track;
    if (track !== undefined && split.closedTracks.has(track)) moves.push({ from: join("handoffs", name), to: inCycle(n, join("handoffs", name)) });
  }
  return moves;
}

async function logMoves(repo: Repo, n: number): Promise<Move[]> {
  return (await filesIn(join(repo.recordsDir, ACTIVITY_DIR))).map((name) => ({ from: join(ACTIVITY_DIR, name), to: inCycle(n, join(ACTIVITY_DIR, name)) }));
}

export interface PlanContext {
  by: { track: string; agent: string };
  now: Date;
  input: CloseInput;
}

export async function planClose(repo: Repo, { by, now, input }: PlanContext): Promise<ClosePlan> {
  const ledger = await new Records(repo).readLedger();
  const cycles = await readCycles(repo.recordsDir);
  const n = cycles.current;
  const tip = await gitMust(repo.root, ["rev-parse", `--short=${SHORT}`, repo.config.mainBranch]);
  const tracks = await readTracks(repo.recordsDir);
  const split: Split = { archived: new Set(ledger.milestones.filter((one) => !isCarried(one)).map((one) => one.id)), closedTracks: new Set(tracks.tracks.filter((track) => !isOpen(track)).map((track) => track.name)) };
  const at = now.toISOString();
  const closeNote = (id: string): Note => ({ id, from: by, to: "all", kind: "heads-up", text: `cycle ${n} was closed by ${by.agent}: ${input.summary}`.slice(0, 600), at, replies: [] });
  const record: CycleRecord = { n, ...(input.name === undefined ? {} : { name: input.name }), from: ledger.baseline, to: tip, closedAt: at, closedBy: by, said: input.said, ...(input.decision === undefined ? {} : { decision: input.decision }), summary: input.summary };
  const writes = [
    ...(await ledgerWrites(n, ledger, tip)),
    ...(await trackWrites(repo, n)),
    ...(await phaseWrites(repo, n, ledger, split, { closedAt: at, closedBy: by, commit: tip })),
    ...(await reviewWrites(repo, n, split)),
    ...(await buildlogWrites(repo, n, split)),
    ...(await noteWrites(repo, n, split, closeNote)),
  ];
  const moves = [...(await evidenceMoves(repo, n, split)), ...(await handoffMoves(repo, n, split)), ...(await logMoves(repo, n))];
  return { schema: 1, n, writes, moves, last: { path: "cycles.json", contents: { ...cycles, current: n + 1, cycles: [...cycles.cycles, record] } } };
}
