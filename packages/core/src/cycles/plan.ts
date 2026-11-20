import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { z } from "zod";
import { gitMust } from "../git/run.ts";
import { phaseRows, isClosed } from "../phases/rows.ts";
import { readablePhases } from "../phases/file.ts";
import { ACTIVITY_DIR } from "../records/activity.ts";
import { evidencePath } from "../records/evidence.ts";
import { handoffPath } from "../records/handoffs.ts";
import { manualPath } from "../records/manual.ts";
import { MAX_NOTE, readNotes, type Note } from "../records/notes.ts";
import { TALLY } from "../records/tell.ts";
import { configSchema, type Config } from "../schema/config.ts";
import type { Exact } from "../schema/kept.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { TracksFile } from "../schema/tracks.ts";
import { readJson } from "../store/json.ts";
import { CONFIG_FILE, RECORDS_DIR, type Repo } from "../store/records.ts";
import { isOpen, isPresent, readTracks } from "../tracks/file.ts";
import { CYCLES_DIR, cycleSchema, readCycles, type CycleRecord } from "./file.ts";
import { isCarried } from "./state.ts";
import { keptMovesOf } from "./kept.ts";

export const moveSchema = z.object({ from: z.string().min(1), to: z.string().min(1) });

export const planSchema = z.object({
  schema: z.literal(1),
  n: z.number().int().positive(),
  record: cycleSchema,
  milestones: z.array(z.string().min(1)).min(1),
  tracks: z.array(z.string().min(1)),
  phases: z.object({ close: z.array(z.string().min(1)), archive: z.array(z.string().min(1)), listed: z.array(z.string().min(1)) }),
  notes: z.array(z.string().min(1)),
  note: z.string().min(1),
  moves: z.array(moveSchema),
  kept: z.array(moveSchema).optional(),
  keptSkipped: z.array(z.string()).optional(),
});

export type Move = Exact<z.infer<typeof moveSchema>>;
export type ClosePlan = Exact<z.infer<typeof planSchema>>;

export interface CloseInput {
  summary: string;
  said: string;
  name?: string | undefined;
  decision?: string | undefined;
}

export interface PlanContext {
  by: { track: string; agent: string };
  now: Date;
  input: CloseInput;
  tracks?: readonly string[];
  moves?: readonly Move[];
}

const SHORT = 7;

const inCycle = (n: number, path: string): string => join(CYCLES_DIR, `cycle-${n}`, path);

export const archivedIds = (ledger: Ledger): string[] => ledger.milestones.filter((one) => !isCarried(one)).map((one) => one.id);

export const closedNames = (file: TracksFile): string[] => [...new Set(file.tracks.filter((track) => !isOpen(track)).map((track) => track.name))];

export const closeText = (n: number, agent: string, summary: string): string => `cycle ${n} was closed by ${agent}: ${summary}`.slice(0, MAX_NOTE);

const baseConfig = (repo: Repo): Promise<Config> => readJson(join(repo.root, RECORDS_DIR, CONFIG_FILE), configSchema);

async function dayFiles(repo: Repo): Promise<string[]> {
  const dir = join(repo.recordsDir, ACTIVITY_DIR);
  return (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".json")).sort().map((name) => join(dir, name));
}

export async function movesOf(repo: Repo, n: number, milestones: readonly string[], tracks: readonly string[], closing: readonly string[]): Promise<Move[]> {
  const open = (await readTracks(repo.recordsDir)).tracks.filter(isOpen).map((track) => track.name).filter((name) => !closing.includes(name));
  const staying = new Set([repo.config.mainBranch, ...(await baseConfig(repo)).tracks.map((track) => track.name), ...open]);
  const paths = [...milestones.flatMap((id) => [evidencePath(repo, id), manualPath(repo, id)]), ...tracks.filter((name) => !staying.has(name)).map((name) => handoffPath(repo, name)), ...(await dayFiles(repo))];
  const present = await Promise.all(paths.map(isPresent));
  return paths.filter((_, index) => present[index] === true).map((path) => relative(repo.recordsDir, path)).map((from) => ({ from, to: inCycle(n, from) }));
}

async function phasePlan(repo: Repo, ledger: Ledger, archived: ReadonlySet<string>): Promise<ClosePlan["phases"]> {
  const rows = await phaseRows(repo);
  const records = (await readablePhases(repo.recordsDir)).value.phases;
  const listed = new Set((await baseConfig(repo)).stages.map((stage) => stage.id));
  const owned = (stage: string): string[] => ledger.milestones.filter((milestone) => milestone.stage === stage).map((milestone) => milestone.id);
  const closes = (stage: string): boolean => owned(stage).length > 0 && owned(stage).every((id) => archived.has(id));
  const close = rows.filter((row) => !isClosed(row) && closes(row.id)).map((row) => row.id);
  const archive = [...new Set([...records.filter(isClosed).map((record) => record.id), ...close])];
  return { close, archive, listed: archive.filter((id) => listed.has(id)) };
}

const isArchivedNote = (note: Note, closedTracks: ReadonlySet<string>): boolean =>
  note.doneAt !== undefined || note.from.agent === TALLY || (note.to !== "all" && note.to.every((track) => closedTracks.has(track)));

async function archivedNotes(repo: Repo, closedTracks: ReadonlySet<string>): Promise<string[]> {
  return (await readNotes(repo)).notes.filter((note) => isArchivedNote(note, closedTracks)).map((note) => note.id);
}

export async function planClose(repo: Repo, ledger: Ledger, context: PlanContext): Promise<ClosePlan> {
  const { by, now, input } = context;
  const n = (await readCycles(repo.recordsDir)).current;
  const tip = await gitMust(repo.root, ["rev-parse", `--short=${SHORT}`, repo.config.mainBranch]);
  const milestones = archivedIds(ledger);
  const tracks = context.tracks ?? closedNames(await readTracks(repo.recordsDir));
  const moves = context.moves ?? (await movesOf(repo, n, milestones, tracks, []));
  const record: CycleRecord = { n, ...(input.name === undefined ? {} : { name: input.name }), from: ledger.baseline, to: tip, closedAt: now.toISOString(), closedBy: by, said: input.said, ...(input.decision === undefined ? {} : { decision: input.decision }), summary: input.summary };
  const phases = await phasePlan(repo, ledger, new Set(milestones));
  const kept = await keptMovesOf(repo, n, tracks);
  return { schema: 1, n, record, milestones, tracks: [...tracks], phases, notes: await archivedNotes(repo, new Set(tracks)), note: closeText(n, by.agent, input.summary), moves: [...moves], ...(kept.moves.length === 0 ? {} : { kept: kept.moves }), ...(kept.skipped.length === 0 ? {} : { keptSkipped: kept.skipped }) };
}
