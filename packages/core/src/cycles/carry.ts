import { mkdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ZodType } from "zod";
import { phasesPath } from "../phases/file.ts";
import { buildlogFileSchema, buildlogPath, type BuildlogFile } from "../records/buildlog.ts";
import { notesFileSchema, notesPath, type Note, type NotesFile } from "../records/notes.ts";
import { reviewsPath } from "../records/reviews.ts";
import { ledgerSchema } from "../schema/ledger.ts";
import { PHASES_FILE, phasesFileSchema, type PhaseRecord, type PhasesFile } from "../schema/phases.ts";
import { reviewsFileSchema, type ReviewsFile } from "../schema/reviews.ts";
import { TRACKS_FILE, tracksFileSchema, type TracksFile } from "../schema/tracks.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { LEDGER_FILE, type Repo } from "../store/records.ts";
import { isOpen, isPresent, tracksPath } from "../tracks/file.ts";
import { cycleDir, cyclesFileSchema, cyclesPath, readCycles } from "./file.ts";
import type { ClosePlan, Move } from "./plan.ts";
import { moveKept } from "./kept.ts";

type Step = (repo: Repo, plan: ClosePlan) => Promise<void>;

interface Listed<F, I> {
  file: string;
  schema: ZodType<F>;
  items: (file: F) => readonly I[];
  with: (file: F, items: readonly I[]) => F;
  key: (item: I) => string;
  archived: (item: I, plan: ClosePlan) => boolean;
}

const NOTES_FILE = join("context", "notes.json");
const NO_PHASES: PhasesFile = { schema: 1, phases: [] };

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const whole = (item: unknown): string => JSON.stringify(item);
const here = (repo: Repo, file: string): string => join(repo.recordsDir, file);
const there = (repo: Repo, plan: ClosePlan, file: string): string => join(cycleDir(repo.recordsDir, plan.n), file);

async function maybe<T>(path: string, schema: ZodType<T>): Promise<T | undefined> {
  return (await isPresent(path)) ? readJson(path, schema) : undefined;
}

function merged<T>(kept: readonly T[], moving: readonly T[], key: (item: T) => string): T[] {
  const incoming = new Map(moving.map((item) => [key(item), item]));
  const known = new Set(kept.map(key));
  return [...kept.map((item) => incoming.get(key(item)) ?? item), ...moving.filter((item) => !known.has(key(item)))];
}

async function archivedInto<F>(path: string, schema: ZodType<F>, archive: F | undefined, next: F): Promise<void> {
  const parsed = schema.parse(next);
  if (archive === undefined || !same(archive, parsed)) await writeJsonAtomic(path, parsed);
}

function archiving<F, I>(spec: Listed<F, I>): Step {
  return async (repo, plan) => {
    const current = await maybe(here(repo, spec.file), spec.schema);
    if (current === undefined) return;
    const moving = spec.items(current).filter((item) => spec.archived(item, plan));
    const archive = await maybe(there(repo, plan, spec.file), spec.schema);
    if (archive !== undefined && moving.length === 0) return;
    await archivedInto(there(repo, plan, spec.file), spec.schema, archive, spec.with(archive ?? current, merged(archive === undefined ? [] : spec.items(archive), moving, spec.key)));
  };
}

function pruning<F, I>(spec: Listed<F, I>): Step {
  return async (repo, plan) => {
    const current = await maybe(here(repo, spec.file), spec.schema);
    if (current === undefined) return;
    const items = spec.items(current);
    const kept = items.filter((item) => !spec.archived(item, plan));
    if (kept.length === items.length) return;
    await writeJsonAtomic(here(repo, spec.file), spec.schema.parse(spec.with(current, kept)));
  };
}

const inArchive = (milestone: string, plan: ClosePlan): boolean => plan.milestones.includes(milestone);

const TRACKS: Listed<TracksFile, TracksFile["tracks"][number]> = {
  file: TRACKS_FILE, schema: tracksFileSchema, items: (file) => file.tracks, with: (file, tracks) => ({ ...file, tracks: [...tracks] }),
  key: (track) => `${track.name} ${track.closedAt ?? ""}`, archived: (track, plan) => !isOpen(track) && plan.tracks.includes(track.name),
};

const REVIEWS: Listed<ReviewsFile, ReviewsFile["reviews"][number]> = {
  file: "reviews.json", schema: reviewsFileSchema, items: (file) => file.reviews, with: (file, reviews) => ({ ...file, reviews: [...reviews] }),
  key: (review) => review.id, archived: (review, plan) => inArchive(review.milestone, plan),
};

const BUILDLOG: Listed<BuildlogFile, BuildlogFile["entries"][number]> = {
  file: "buildlog.json", schema: buildlogFileSchema, items: (file) => file.entries, with: (file, entries) => ({ ...file, entries: [...entries] }),
  key: whole, archived: (entry, plan) => inArchive(entry.milestone, plan),
};

const NOTES: Listed<NotesFile, Note> = {
  file: NOTES_FILE, schema: notesFileSchema, items: (file) => file.notes, with: (file, notes) => ({ ...file, notes: [...notes] }),
  key: (note) => note.id, archived: (note, plan) => plan.notes.includes(note.id),
};

const ledgerArchive: Step = async (repo, plan) => {
  const current = await readJson(here(repo, LEDGER_FILE), ledgerSchema);
  const moving = current.milestones.filter((milestone) => inArchive(milestone.id, plan));
  if (moving.length === 0) return;
  const archive = await maybe(there(repo, plan, LEDGER_FILE), ledgerSchema);
  const next = { ...(archive ?? current), milestones: merged(archive?.milestones ?? [], moving, (one) => one.id), other: merged(archive?.other ?? [], current.other, whole) };
  await archivedInto(there(repo, plan, LEDGER_FILE), ledgerSchema, archive, next);
};

const ledgerPrune: Step = async (repo, plan) => {
  const current = await readJson(here(repo, LEDGER_FILE), ledgerSchema);
  const kept = current.milestones.filter((milestone) => !inArchive(milestone.id, plan));
  if (kept.length === current.milestones.length) return;
  await writeJsonAtomic(here(repo, LEDGER_FILE), ledgerSchema.parse({ ...current, baseline: plan.record.to, other: [], milestones: kept }));
};

const closingOf = (plan: ClosePlan): Pick<PhaseRecord, "closedAt" | "closedBy" | "commit" | "summary"> => ({ closedAt: plan.record.closedAt, closedBy: plan.record.closedBy, commit: plan.record.to, summary: `closed with cycle ${plan.n}` });

function withClosings(file: PhasesFile, plan: ClosePlan): PhasesFile {
  const closing = closingOf(plan);
  const shut = (record: PhaseRecord): PhaseRecord => (plan.phases.close.includes(record.id) && record.closedAt === undefined ? { ...record, ...closing } : record);
  const missing = plan.phases.close.filter((id) => plan.phases.listed.includes(id) && !file.phases.some((record) => record.id === id)).map((id): PhaseRecord => ({ id, ...closing }));
  return { ...file, phases: [...file.phases.map(shut), ...missing] };
}

const leaves = (record: PhaseRecord, plan: ClosePlan): boolean => plan.phases.archive.includes(record.id) && record.closedAt !== undefined && !plan.phases.listed.includes(record.id);

const phasesArchive: Step = async (repo, plan) => {
  const current = withClosings((await maybe(here(repo, PHASES_FILE), phasesFileSchema)) ?? NO_PHASES, plan);
  const moving = current.phases.filter((record) => plan.phases.archive.includes(record.id));
  if (moving.length === 0) return;
  const archive = await maybe(there(repo, plan, PHASES_FILE), phasesFileSchema);
  await archivedInto(there(repo, plan, PHASES_FILE), phasesFileSchema, archive, { ...(archive ?? current), phases: merged(archive?.phases ?? [], moving, (record) => record.id) });
};

const phasesPrune: Step = async (repo, plan) => {
  const before = phasesFileSchema.parse((await maybe(here(repo, PHASES_FILE), phasesFileSchema)) ?? NO_PHASES);
  const closed = withClosings(before, plan);
  const next = phasesFileSchema.parse({ ...closed, phases: closed.phases.filter((record) => !leaves(record, plan)) });
  if (!same(before, next)) await writeJsonAtomic(here(repo, PHASES_FILE), next);
};

const isCloseNote = (note: Note, plan: ClosePlan): boolean =>
  note.text === plan.note && note.at === plan.record.closedAt && note.from.track === plan.record.closedBy.track && note.from.agent === plan.record.closedBy.agent;

const notesPrune: Step = async (repo, plan) => {
  const current = (await maybe(here(repo, NOTES_FILE), notesFileSchema)) ?? { schema: 1 as const, nextNumber: 1, notes: [] };
  const kept = current.notes.filter((note) => !plan.notes.includes(note.id));
  const posted = current.notes.some((note) => isCloseNote(note, plan));
  if (posted && kept.length === current.notes.length) return;
  const note: Note[] = posted ? [] : [{ id: `note-${current.nextNumber}`, from: plan.record.closedBy, to: "all", kind: "heads-up", text: plan.note, at: plan.record.closedAt, replies: [] }];
  await writeJsonAtomic(here(repo, NOTES_FILE), notesFileSchema.parse({ ...current, nextNumber: current.nextNumber + note.length, notes: [...kept, ...note] }));
};

const moved = (move: Move): Step => async (repo) => {
  const to = join(repo.recordsDir, move.to);
  if (await isPresent(to)) return;
  const from = join(repo.recordsDir, move.from);
  if (!(await isPresent(from))) return;
  await mkdir(dirname(to), { recursive: true });
  await rename(from, to);
};

const keptMoved = (move: Move): Step => (repo) => moveKept(repo, move);

const recorded: Step = async (repo, plan) => {
  const file = await readCycles(repo.recordsDir);
  if (file.cycles.some((cycle) => cycle.n === plan.n)) return;
  await writeJsonAtomic(cyclesPath(repo.recordsDir), cyclesFileSchema.parse({ ...file, current: plan.n + 1, cycles: [...file.cycles, plan.record] }));
};

const operationsOf = (plan: ClosePlan): Step[] => [
  ledgerArchive, ledgerPrune, archiving(TRACKS), pruning(TRACKS), phasesArchive, phasesPrune, archiving(REVIEWS), pruning(REVIEWS),
  archiving(BUILDLOG), pruning(BUILDLOG), archiving(NOTES), notesPrune, ...plan.moves.map(moved), ...(plan.kept ?? []).map(keptMoved), recorded,
];

export async function carryOut(repo: Repo, plan: ClosePlan, steps = Number.POSITIVE_INFINITY): Promise<void> {
  for (const operation of operationsOf(plan).slice(0, steps)) await operation(repo, plan);
}

export async function assertReadable(repo: Repo): Promise<void> {
  await readJson(here(repo, LEDGER_FILE), ledgerSchema);
  await maybe(here(repo, TRACKS_FILE), tracksFileSchema);
  await maybe(here(repo, PHASES_FILE), phasesFileSchema);
  await maybe(here(repo, REVIEWS.file), reviewsFileSchema);
  await maybe(here(repo, BUILDLOG.file), buildlogFileSchema);
  await maybe(here(repo, NOTES_FILE), notesFileSchema);
  await readCycles(repo.recordsDir);
}

export const ledgerLock = (repo: Repo): string => here(repo, LEDGER_FILE);

export const recordLocks = (repo: Repo): string[] => [tracksPath(repo.recordsDir), phasesPath(repo.recordsDir), reviewsPath(repo), buildlogPath(repo), notesPath(repo), cyclesPath(repo.recordsDir)];

export const moveLocks = (repo: Repo, moves: readonly Move[]): string[] => moves.map((move) => join(repo.recordsDir, move.from)).sort();

export const lockPaths = (repo: Repo, plan: ClosePlan): string[] => [ledgerLock(repo), ...recordLocks(repo), ...moveLocks(repo, plan.moves)];
