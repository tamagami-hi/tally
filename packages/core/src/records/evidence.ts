import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { TallyError, messageOf } from "../errors.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { assertMayWrite, type Session } from "../state/sessions.ts";
import { commitRecords } from "./commit.ts";
import { safeName } from "./handoffs.ts";
import { summarize } from "./totals.ts";

export const evidenceKinds = ["red", "green", "clippy", "fmt", "sweep", "coverage", "land", "evidence", "other"] as const;

export const runRecordSchema = z.object({
  id: z.string().min(1),
  task: z.string().min(1),
  track: z.string().min(1),
  agent: z.string().min(1),
  kind: z.enum(evidenceKinds),
  command: z.array(z.string()).min(1),
  cwd: z.string().min(1),
  started: z.string(),
  seconds: z.number().nonnegative(),
  exit: z.number().int(),
  log: z.object({ path: z.string(), sha256: z.string().length(64), bytes: z.number().int().nonnegative() }).optional(),
  summary: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
  note: z.string().optional(),
});

export const evidenceFileSchema = z.object({
  schema: z.literal(1),
  milestone: z.string().min(1),
  records: z.array(runRecordSchema).default([]),
});

export type RunRecord = z.infer<typeof runRecordSchema>;
export type EvidenceKind = (typeof evidenceKinds)[number];

export const evidencePath = (repo: Repo, milestone: string): string => join(repo.recordsDir, "evidence", `${safeName(milestone)}.json`);

export async function readEvidence(repo: Repo, milestone: string): Promise<z.infer<typeof evidenceFileSchema>> {
  try {
    return await readJson(evidencePath(repo, milestone), evidenceFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, milestone, records: [] };
    throw error;
  }
}

export interface EvidenceInput {
  milestone: string;
  task: string;
  kind: EvidenceKind;
  command: readonly string[];
  cwd: string;
  started: string;
  seconds: number;
  exit: number;
  logPath?: string;
  summary?: Record<string, number | string | boolean>;
  note?: string;
}

async function hashLog(session: Session, logPath: string): Promise<{ log: RunRecord["log"]; text: string }> {
  const absolute = isAbsolute(logPath) ? logPath : resolve(session.worktree, logPath);
  if (relative(session.worktree, absolute).startsWith("..")) throw new TallyError(`the log must be inside the session's worktree: ${logPath}`);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch {
    throw new TallyError(`the log does not exist: ${absolute}`);
  }
  const log = { path: absolute, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: (await stat(absolute)).size };
  return { log, text: bytes.toString("utf8") };
}

function notRed(exit: number, summary: EvidenceInput["summary"]): string | null {
  if (exit === 0) return "it exited 0";
  const failed = summary?.["failed"];
  if (typeof failed !== "number" || failed === 0) return `it exited ${exit} with no failed test, such as a compile or usage error`;
  return null;
}

export function judgeRed(run: Pick<EvidenceInput, "kind" | "exit" | "summary" | "note">): { kind: EvidenceKind; note?: string; notice?: string } {
  const { kind, exit, summary, note } = run;
  const reason = kind === "red" ? notRed(exit, summary) : null;
  if (reason === null) return { kind, ...(note === undefined ? {} : { note }) };
  const notice = `recorded as other, not red: ${reason}`;
  return { kind: "other", note: note === undefined ? notice : `${notice}; ${note}`, notice };
}

export function writableTrack(repo: Repo, session: Session, ledger: Ledger, input: Pick<EvidenceInput, "milestone" | "task">): string {
  const task = findTask(findMilestone(ledger, input.milestone), input.task);
  if (task === undefined) throw new TallyError(`'${input.task}' is not planned in ${input.milestone}`);
  assertMayWrite(repo, session, task.track);
  return task.track;
}

function composeRecord(session: Session, track: string, input: EvidenceInput, log?: RunRecord["log"]): RunRecord {
  return {
    id: randomUUID(),
    task: input.task,
    track,
    agent: session.agent,
    kind: input.kind,
    command: [...input.command],
    cwd: input.cwd,
    started: input.started,
    seconds: input.seconds,
    exit: input.exit,
    ...(log === undefined ? {} : { log }),
    ...(input.summary === undefined ? {} : { summary: input.summary }),
    ...(input.note === undefined ? {} : { note: input.note }),
  };
}

async function appendRecord(repo: Repo, milestone: string, record: RunRecord): Promise<void> {
  const path = evidencePath(repo, milestone);
  await withLock(path, async () => {
    const file = await readEvidence(repo, milestone);
    await writeJsonAtomic(path, { ...file, records: [...file.records, record] });
  });
}

const commitLine = (milestone: string, record: RunRecord): string => `${milestone} '${record.task}': ${record.kind} exit ${record.exit}`;

export async function recordEvidence(repo: Repo, session: Session, ledger: Ledger, input: EvidenceInput): Promise<{ record: RunRecord; commit: string | null; notice?: string }> {
  const track = writableTrack(repo, session, ledger, input);
  const read = input.logPath === undefined ? undefined : await hashLog(session, input.logPath);
  const summary = input.summary ?? (read === undefined ? undefined : summarize(read.text));
  const measured = summary === undefined ? input : { ...input, summary };
  const { notice, ...verdict } = judgeRed(measured);
  const record = composeRecord(session, track, { ...measured, ...verdict }, read?.log);
  await appendRecord(repo, input.milestone, record);
  const commit = await commitRecords(repo, commitLine(input.milestone, record));
  return { record, commit, ...(notice === undefined ? {} : { notice }) };
}

export interface Kept {
  record: RunRecord;
  recorded: boolean;
  commit: string | null;
  problem?: string;
  notice?: string;
}

async function committed(repo: Repo, milestone: string, record: RunRecord): Promise<Kept> {
  try {
    return { record, recorded: true, commit: await commitRecords(repo, commitLine(milestone, record)) };
  } catch (error: unknown) {
    return { record, recorded: true, commit: null, problem: `the record is written but not committed: ${messageOf(error)}` };
  }
}

export async function keepRun(repo: Repo, session: Session, track: string, input: EvidenceInput & { logPath: string }): Promise<Kept> {
  const { notice, ...verdict } = judgeRed(input);
  const judged = { ...input, ...verdict };
  const told = notice === undefined ? {} : { notice };
  try {
    const { log } = await hashLog(session, input.logPath);
    const record = composeRecord(session, track, judged, log);
    await appendRecord(repo, input.milestone, record);
    return { ...(await committed(repo, input.milestone, record)), ...told };
  } catch (error: unknown) {
    return { record: composeRecord(session, track, judged), recorded: false, commit: null, problem: messageOf(error), ...told };
  }
}

export async function listEvidence(repo: Repo, milestone: string, task?: string): Promise<RunRecord[]> {
  const file = await readEvidence(repo, milestone);
  return task === undefined ? file.records : file.records.filter((r) => r.task === task);
}

export interface MilestoneEvidence {
  milestone: string;
  records: RunRecord[];
}

export async function evidenceFiles(repo: Repo): Promise<string[]> {
  const dir = join(repo.recordsDir, "evidence");
  try {
    return (await readdir(dir)).filter((name) => name.endsWith(".json")).sort().map((name) => join(dir, name));
  } catch {
    return [];
  }
}

export async function readAllEvidence(repo: Repo): Promise<MilestoneEvidence[]> {
  const all: MilestoneEvidence[] = [];
  for (const path of await evidenceFiles(repo)) {
    const file = await readJson(path, evidenceFileSchema);
    all.push({ milestone: file.milestone, records: file.records });
  }
  return all;
}

export async function findEvidence(repo: Repo, id: string): Promise<{ milestone: string; record: RunRecord } | null> {
  for (const { milestone, records } of await readAllEvidence(repo)) {
    const record = records.find((r) => r.id === id);
    if (record !== undefined) return { milestone, record };
  }
  return null;
}
