import { TallyError, messageOf } from "../errors.ts";
import { gitMust } from "../git/run.ts";
import { MAX_NOTE, noteFrom } from "../records/notes.ts";
import { readBuildlog } from "../records/buildlog.ts";
import { commitRecords, commitWhenFree, phaseSubject, recordsMode } from "../records/commit.ts";
import { clearPendingPhase, markPendingPhase } from "../records/pending-phase.ts";
import type { PhaseRecord } from "../schema/phases.ts";
import type { Ledger } from "../schema/ledger.ts";
import { isOperator, type Session } from "../state/sessions.ts";
import { closeOpened } from "../tracks/close.ts";
import { isOpen, readTracks } from "../tracks/file.ts";
import { Records, type Repo } from "../store/records.ts";
import { MOST_LEFT, blockersOf, contextOf, tasksOf } from "./blockers.ts";
import { changePhases } from "./file.ts";
import { andList, isClosed, phaseRows } from "./rows.ts";

export interface PhaseClosed {
  phase: PhaseRecord;
  milestones: string[];
  tasks: { total: number; landed: number };
  tracksClosed: string[];
  tracksLeft: { name: string; why: string }[];
  withoutBuildLog?: string[];
  commit: string | null;
  waits?: string;
  problem?: string;
}

const MOST_SUMMARY = 500;
const WAITS = "a landing has its turn, so the records commit waits and is made when that landing finishes";

function checkedSummary(summary: string): string {
  const text = summary.trim();
  if (text === "") throw new TallyError("closing a phase needs a summary");
  if (text.length > MOST_SUMMARY) throw new TallyError(`the summary holds at most ${MOST_SUMMARY} characters; this one has ${text.length}`);
  return text;
}

function refusal(phase: string, blockers: readonly string[]): TallyError {
  const more = blockers.length > 1 ? `; ${blockers.length - 1} more stop it, and phase_list names them` : "";
  return new TallyError(`phase ${phase} cannot close: ${blockers[0] ?? ""}${more}`);
}

function ownTracks(ledger: Ledger, phase: string, opened: readonly string[]): string[] {
  const inPhase = new Set(tasksOf(ledger, phase).milestones.map((milestone) => milestone.id));
  const tasks = ledger.milestones.flatMap((milestone) => milestone.tasks.map((task) => ({ milestone: milestone.id, track: task.track })));
  return opened.filter((name) => {
    const own = tasks.filter((task) => task.track === name);
    return own.length > 0 && own.every((task) => inPhase.has(task.milestone));
  });
}

async function closeTracks(repo: Repo, session: Pick<Session, "track" | "agent">, ledger: Ledger, phase: string, now: Date): Promise<Pick<PhaseClosed, "tracksClosed" | "tracksLeft">> {
  const opened = (await readTracks(repo.recordsDir)).tracks.filter(isOpen).map((track) => track.name);
  const result: Pick<PhaseClosed, "tracksClosed" | "tracksLeft"> = { tracksClosed: [], tracksLeft: [] };
  for (const name of ownTracks(ledger, phase, opened)) {
    try {
      await closeOpened(repo, name, { by: { track: session.track, agent: session.agent }, now, why: `phase ${phase} closed` });
      result.tracksClosed.push(name);
    } catch (error: unknown) {
      result.tracksLeft.push({ name, why: messageOf(error) });
    }
  }
  return result;
}

async function committedAtOnce(repo: Repo, phase: string, agent: string): Promise<string | null> {
  return recordsMode(repo.config) === "each" ? commitRecords(repo, `phase ${phase} closed by ${agent}`) : null;
}

async function committedTogether(repo: Repo, phase: string, summary: string): Promise<Pick<PhaseClosed, "commit" | "waits" | "problem">> {
  const mode = recordsMode(repo.config);
  if (mode === "each" || mode === "never") return { commit: null };
  try {
    if (mode === "phase") await markPendingPhase(repo, phase, summary);
    const done = await commitWhenFree(repo, phaseSubject(phase), summary);
    if (done.waits) return { commit: null, waits: WAITS };
    if (mode === "phase") await clearPendingPhase(repo);
    return { commit: done.commit };
  } catch (error: unknown) {
    if (mode === "phase") await clearPendingPhase(repo);
    return { commit: null, problem: messageOf(error) };
  }
}

async function withoutBuildLog(repo: Repo, milestones: readonly string[]): Promise<string[]> {
  const written = new Set((await readBuildlog(repo)).entries.map((entry) => entry.milestone));
  return milestones.filter((id) => !written.has(id));
}

export async function closePhase(repo: Repo, session: Pick<Session, "track" | "agent">, input: { phase: string; summary: string }, now = new Date()): Promise<PhaseClosed> {
  if (!isOperator(repo, session)) throw new TallyError("only an operator session closes a phase; a track that wants one closed asks a question with question_add");
  const summary = checkedSummary(input.summary);
  const rows = await phaseRows(repo);
  const row = rows.find((one) => one.id === input.phase);
  if (row === undefined) throw new TallyError(`no phase ${input.phase}; the phases are ${andList(rows.map((one) => one.id))}`);
  if (isClosed(row)) throw new TallyError(`phase ${row.id} was closed on ${row.closedAt ?? "an earlier day"} by ${row.closedBy?.agent ?? "someone"}; later work goes in a new phase (phase_add)`);
  const ledger = await new Records(repo).readLedger();
  const blockers = blockersOf(await contextOf(repo, ledger), ledger, row.id);
  if (blockers.length > 0) throw refusal(row.id, blockers.slice(0, MOST_LEFT));
  const { milestones, total, landed } = tasksOf(ledger, row.id);
  const tracks = await closeTracks(repo, session, ledger, row.id, now);
  const by = { track: session.track, agent: session.agent };
  const tip = await gitMust(repo.root, ["rev-parse", "--short=7", repo.config.mainBranch]);
  const phase = await changePhases(repo.recordsDir, (file) => {
    const closing = { closedAt: now.toISOString(), closedBy: by, summary, commit: tip };
    const held = file.phases.find((one) => one.id === row.id);
    if (held !== undefined && isClosed(held)) throw new TallyError(`phase ${row.id} was closed on ${held.closedAt ?? "an earlier day"} by ${held.closedBy?.agent ?? "someone"}; later work goes in a new phase (phase_add)`);
    const next: PhaseRecord = { ...(held ?? { id: row.id }), ...closing };
    return { file: { ...file, phases: held === undefined ? [...file.phases, next] : file.phases.map((one) => (one.id === row.id ? next : one)) }, result: next };
  });
  const early = await committedAtOnce(repo, row.id, session.agent);
  await noteFrom(repo, by, { to: "all", kind: "heads-up", text: `phase ${row.id} was closed by ${session.agent}: ${summary}`.slice(0, MAX_NOTE) }, now);
  const together = await committedTogether(repo, row.id, summary);
  const result = { ...together, commit: together.commit ?? early };
  const ids = milestones.map((milestone) => milestone.id);
  const unlogged = await withoutBuildLog(repo, ids);
  return { phase, milestones: ids, tasks: { total, landed }, ...tracks, ...(unlogged.length === 0 ? {} : { withoutBuildLog: unlogged }), ...result };
}
