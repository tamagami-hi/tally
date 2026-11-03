import { createHash, randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { findMilestone, findTask } from "../ledger/items.ts";
import type { Ledger } from "../schema/ledger.ts";
import type { Repo } from "../store/records.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { assertMayWrite, type Session } from "../state/sessions.ts";
import { commitRecords } from "./commit.ts";
import { safeName } from "./handoffs.ts";

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

async function hashLog(session: Session, logPath: string): Promise<RunRecord["log"]> {
  const absolute = isAbsolute(logPath) ? logPath : resolve(session.worktree, logPath);
  if (relative(session.worktree, absolute).startsWith("..")) throw new TallyError(`the log must be inside the session's worktree: ${logPath}`);
  let bytes: Buffer;
  try {
    bytes = await readFile(absolute);
  } catch {
    throw new TallyError(`the log does not exist: ${absolute}`);
  }
  return { path: absolute, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: (await stat(absolute)).size };
}

export async function recordEvidence(repo: Repo, session: Session, ledger: Ledger, input: EvidenceInput): Promise<{ record: RunRecord; commit: string | null }> {
  const milestone = findMilestone(ledger, input.milestone);
  const task = findTask(milestone, input.task);
  if (task === undefined) throw new TallyError(`'${input.task}' is not planned in ${input.milestone}`);
  assertMayWrite(repo, session, task.track);
  const log = input.logPath === undefined ? undefined : await hashLog(session, input.logPath);
  const record: RunRecord = {
    id: randomUUID(),
    task: input.task,
    track: task.track,
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
  const path = evidencePath(repo, input.milestone);
  await withLock(path, async () => {
    const file = await readEvidence(repo, input.milestone);
    await writeJsonAtomic(path, { ...file, records: [...file.records, record] });
  });
  const commit = await commitRecords(repo, `${input.milestone} '${input.task}': ${input.kind} exit ${input.exit}`);
  return { record, commit };
}

export async function listEvidence(repo: Repo, milestone: string, task?: string): Promise<RunRecord[]> {
  const file = await readEvidence(repo, milestone);
  return task === undefined ? file.records : file.records.filter((r) => r.task === task);
}
