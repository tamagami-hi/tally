import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { TallyError } from "../errors.ts";
import { keptFileSchema, type Exact } from "../schema/kept.ts";
import { readJson, writeJsonAtomic } from "../store/json.ts";
import { withLock } from "../store/lock.ts";
import { assertCurrent, Records, type Repo } from "../store/records.ts";
import type { Session } from "../state/sessions.ts";
import { commitRecords } from "./commit.ts";
import { writableTrack } from "./evidence.ts";
import { safeName } from "./handoffs.ts";
import { assertStillPlanned } from "./still-planned.ts";
import { hashedFile, missingFile } from "./kept-file.ts";

export const MOST_STEPS = 30;
export const MOST_ATTACHMENTS = 10;
export const MOST_ATTACHMENT_MB = 200;
export const MANUAL_DIR = "manual";
const ATTACHMENTS_ROOT = ".temp";
const MEBIBYTE = 1024 * 1024;

export const manualResults = ["pass", "fail"] as const;

export const manualCheckSchema = z.looseObject({
  id: z.string().min(1),
  task: z.string().min(1),
  who: z.string().min(1),
  device: z.string().optional(),
  build: z.string().optional(),
  steps: z.array(z.string()),
  result: z.enum(manualResults),
  note: z.string().optional(),
  attachments: z.array(keptFileSchema).default([]),
  by: z.looseObject({ session: z.string().min(1), track: z.string().min(1), agent: z.string().min(1) }),
  at: z.string(),
});

export const manualFileSchema = z.looseObject({
  schema: z.literal(1),
  milestone: z.string().min(1),
  checks: z.array(manualCheckSchema).default([]),
});

export type ManualCheck = Exact<z.infer<typeof manualCheckSchema>>;
export type ManualFile = Exact<z.infer<typeof manualFileSchema>>;

export interface ManualInput {
  milestone: string;
  task: string;
  who: string;
  result: (typeof manualResults)[number];
  steps: readonly string[];
  device?: string;
  build?: string;
  note?: string;
  attachments?: readonly string[];
}

export const manualPath = (repo: Repo, milestone: string): string => join(repo.recordsDir, MANUAL_DIR, `${safeName(milestone)}.json`);

export async function readManual(repo: Repo, milestone: string): Promise<ManualFile> {
  try {
    return await readJson(manualPath(repo, milestone), manualFileSchema);
  } catch (error: unknown) {
    if (error instanceof TallyError && error.message.endsWith("does not exist")) return { schema: 1, milestone, checks: [] };
    throw error;
  }
}

export async function listManual(repo: Repo, milestone: string, task?: string): Promise<ManualCheck[]> {
  const { checks } = await readManual(repo, milestone);
  return task === undefined ? checks : checks.filter((check) => check.task === task);
}

function assertShape(input: ManualInput): void {
  if (input.steps.length < 1 || input.steps.length > MOST_STEPS) throw new TallyError(`steps holds 1 to ${MOST_STEPS} lines; this one has ${input.steps.length}`);
  if ((input.attachments ?? []).length > MOST_ATTACHMENTS) throw new TallyError(`a check holds at most ${MOST_ATTACHMENTS} attachments; this one has ${input.attachments?.length}`);
}

async function attachmentsOf(repo: Repo, session: Session, given: readonly string[]): Promise<ManualCheck["attachments"]> {
  const root = join(repo.root, ATTACHMENTS_ROOT);
  const outside = (path: string): string => `an attachment must be a file under the repository's ${ATTACHMENTS_ROOT}/: ${path}`;
  const allowed = { base: session.worktree, folders: [root], outside, missing: missingFile("the attachment", session.worktree, root) };
  const most = { bytes: MOST_ATTACHMENT_MB * MEBIBYTE, what: "an attachment" };
  const files = [];
  for (const path of given) files.push(await hashedFile(path, allowed, most));
  return files;
}

const optional = (input: ManualInput): Partial<ManualCheck> => ({
  ...(input.device === undefined ? {} : { device: input.device }),
  ...(input.build === undefined ? {} : { build: input.build }),
  ...(input.note === undefined ? {} : { note: input.note }),
});

export async function recordManual(repo: Repo, session: Session, input: ManualInput, now = new Date()): Promise<{ check: ManualCheck; commit: string | null }> {
  assertCurrent(repo);
  assertShape(input);
  await assertStillPlanned(repo, input.milestone, input.task);
  writableTrack(repo, session, await new Records(repo).readLedger(), input);
  const attachments = await attachmentsOf(repo, session, input.attachments ?? []);
  const path = manualPath(repo, input.milestone);
  const check = await withLock(path, async () => {
    await assertStillPlanned(repo, input.milestone, input.task);
    const file = await readManual(repo, input.milestone);
    const made: ManualCheck = { id: `manual-${file.checks.length + 1}`, task: input.task, who: input.who, ...optional(input), steps: [...input.steps], result: input.result, attachments, by: { session: session.id, track: session.track, agent: session.agent }, at: now.toISOString() };
    await writeJsonAtomic(path, { ...file, checks: [...file.checks, made] });
    return made;
  });
  const commit = await commitRecords(repo, `${input.milestone} '${input.task}': checked by hand, ${input.result}`);
  return { check, commit };
}

export async function manualFiles(repo: Repo): Promise<string[]> {
  const dir = join(repo.recordsDir, MANUAL_DIR);
  const names = await readdir(dir).catch(() => [] as string[]);
  return names.filter((one) => one.endsWith(".json")).sort().map((name) => join(dir, name));
}

export async function readAllManual(repo: Repo): Promise<ManualFile[]> {
  const files: ManualFile[] = [];
  for (const path of await manualFiles(repo)) files.push(await readJson(path, manualFileSchema));
  return files;
}
