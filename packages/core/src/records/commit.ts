import { TallyError } from "../errors.ts";
import { asIdentity, git, gitMust, type GitResult } from "../git/run.ts";
import { statePath } from "../land/paths.ts";
import { turnInProgress } from "../land/queue.ts";
import type { Config } from "../schema/config.ts";
import { LANDING_RETRIES, LockBusy, withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";
import { clearPendingPhase, readPendingPhase } from "./pending-phase.ts";

export type RecordsMode = "never" | "each" | "rest" | "phase";

export interface Staged {
  commit: string | null;
  files: number;
  waits?: true;
}

export type Subject = (files: number, head: string) => string;

const ATTEMPTS = 5;
const NOTHING: Staged = { commit: null, files: 0 };
const WAITS: Staged = { commit: null, files: 0, waits: true };

export const MOST_SUBJECT = 70;
const BREAKS: readonly string[] = [": ", ", "];

export interface Fitted {
  subject: string;
  moved?: string;
}

function cutAt(line: string, after: number): number {
  const room = line.slice(0, MOST_SUBJECT + 1);
  const phrase = Math.max(...BREAKS.map((mark) => room.lastIndexOf(mark)));
  if (phrase > after) return phrase;
  const space = room.lastIndexOf(" ");
  return space > after ? space : MOST_SUBJECT;
}

export function fittedSubject(prefix: string, text: string): Fitted {
  const line = `${prefix} ${text}`;
  if (line.length <= MOST_SUBJECT) return { subject: line };
  return { subject: line.slice(0, cutAt(line, prefix.length)).trimEnd(), moved: text };
}

export function recordsMode(config: Pick<Config, "records">): RecordsMode {
  const { commit, batch, commitAt } = config.records;
  if (!commit) return "never";
  if (batch !== true) return "each";
  return commitAt === "phase" ? "phase" : "rest";
}

async function untilIndexFree(root: string, args: readonly string[]): Promise<GitResult> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await git(root, args);
    if (result.code === 0 || !result.stderr.includes("index.lock") || attempt === ATTEMPTS) return result;
    await new Promise((done) => setTimeout(done, 150 * attempt));
  }
}

export async function commitStaged(repo: Repo, subject: Subject, body?: string): Promise<Staged> {
  const { config, root } = repo;
  return withLock(statePath(repo, "locks", "landing.lock"), async () => {
    if (await turnInProgress(repo)) return WAITS;
    const added = await untilIndexFree(root, ["add", "--", config.records.dir]);
    if (added.code !== 0) throw new TallyError(`git add -- ${config.records.dir} failed in ${root}:\n${added.stderr.trim()}`);
    const staged = await git(root, ["diff", "--cached", "--name-only", "--", config.records.dir]);
    const files = staged.stdout.split("\n").filter((line) => line !== "").length;
    if (files === 0) return NOTHING;
    const head = await gitMust(root, ["rev-parse", "--short=7", "HEAD"]);
    const fitted = fittedSubject(config.records.commitPrefix, subject(files, head));
    const message = ["-m", fitted.subject, ...[fitted.moved, body].flatMap((part) => (part === undefined ? [] : ["-m", part]))];
    const committed = await untilIndexFree(root, [...asIdentity(config.identity), "commit", "-q", ...message, "--", config.records.dir]);
    if (committed.code !== 0) throw new TallyError(`git commit failed in ${root}:\n${committed.stderr.trim()}`);
    return { commit: await gitMust(root, ["rev-parse", "--short=7", "HEAD"]), files };
  }, LANDING_RETRIES);
}

async function leftWhenBusy(committing: Promise<Staged>): Promise<Staged> {
  try {
    return await committing;
  } catch (error: unknown) {
    if (error instanceof LockBusy) return WAITS;
    throw error;
  }
}

export const commitWhenFree = (repo: Repo, subject: Subject, body?: string): Promise<Staged> => leftWhenBusy(commitStaged(repo, subject, body));

export async function commitRecords(repo: Repo, message: string): Promise<string | null> {
  if (recordsMode(repo.config) !== "each") return null;
  return (await commitWhenFree(repo, () => message)).commit;
}

export async function flushRecords(repo: Repo): Promise<string | null> {
  if (recordsMode(repo.config) === "never") return null;
  const done = await commitStaged(repo, (files, head) => `${files} record file${files === 1 ? "" : "s"} up to ${head}`);
  if (!done.waits) await clearPendingPhase(repo);
  return done.commit;
}

export const phaseSubject = (phase: string): Subject => (files) => `phase ${phase} closed, ${files} record file${files === 1 ? "" : "s"}`;

async function flushClosedPhase(repo: Repo): Promise<string | null> {
  const pending = await readPendingPhase(repo);
  if (pending === undefined) return null;
  const done = await commitWhenFree(repo, phaseSubject(pending.phase), pending.summary);
  if (!done.waits) await clearPendingPhase(repo);
  return done.commit;
}

export async function flushWhenFree(repo: Repo): Promise<string | null> {
  if (recordsMode(repo.config) === "phase") return flushClosedPhase(repo);
  if (recordsMode(repo.config) === "never") return null;
  return (await leftWhenBusy(commitStaged(repo, (files, head) => `${files} record file${files === 1 ? "" : "s"} up to ${head}`))).commit;
}

export const flushPendingPhase = async (repo: Repo): Promise<string | null> => (recordsMode(repo.config) === "phase" ? flushClosedPhase(repo) : null);
