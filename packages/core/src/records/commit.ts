import { TallyError } from "../errors.ts";
import { git, gitMust, type GitResult } from "../git/run.ts";
import { statePath } from "../land/paths.ts";
import { LANDING_RETRIES, LockBusy, withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";

const ATTEMPTS = 5;

async function untilIndexFree(root: string, args: readonly string[]): Promise<GitResult> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await git(root, args);
    if (result.code === 0 || !result.stderr.includes("index.lock") || attempt === ATTEMPTS) return result;
    await new Promise((done) => setTimeout(done, 150 * attempt));
  }
}

async function commitStaged(repo: Repo, message: (files: number, head: string) => string): Promise<string | null> {
  const { config, root } = repo;
  return withLock(statePath(repo, "locks", "landing.lock"), async () => {
    const added = await untilIndexFree(root, ["add", "--", config.records.dir]);
    if (added.code !== 0) throw new TallyError(`git add -- ${config.records.dir} failed in ${root}:\n${added.stderr.trim()}`);
    const staged = await git(root, ["diff", "--cached", "--name-only", "--", config.records.dir]);
    const files = staged.stdout.split("\n").filter((line) => line !== "").length;
    if (files === 0) return null;
    const head = await gitMust(root, ["rev-parse", "--short=7", "HEAD"]);
    const identity = ["-c", `user.name=${config.identity.name}`, "-c", `user.email=${config.identity.email}`];
    const committed = await untilIndexFree(root, [...identity, "commit", "-q", "-m", `${config.records.commitPrefix} ${message(files, head)}`, "--", config.records.dir]);
    if (committed.code !== 0) throw new TallyError(`git commit failed in ${root}:\n${committed.stderr.trim()}`);
    return gitMust(root, ["rev-parse", "--short=7", "HEAD"]);
  }, LANDING_RETRIES);
}

async function leftWhenBusy(committing: Promise<string | null>): Promise<string | null> {
  try {
    return await committing;
  } catch (error: unknown) {
    if (error instanceof LockBusy) return null;
    throw error;
  }
}

export async function commitRecords(repo: Repo, message: string): Promise<string | null> {
  const { commit, batch } = repo.config.records;
  if (!commit || batch === true) return null;
  return leftWhenBusy(commitStaged(repo, () => message));
}

export async function flushRecords(repo: Repo): Promise<string | null> {
  if (!repo.config.records.commit) return null;
  return commitStaged(repo, (files, head) => `${files} record file${files === 1 ? "" : "s"} up to ${head}`);
}

export async function flushWhenFree(repo: Repo): Promise<string | null> {
  return leftWhenBusy(flushRecords(repo));
}
