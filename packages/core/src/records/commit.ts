import { TallyError } from "../errors.ts";
import { git, gitMust, type GitResult } from "../git/run.ts";
import { statePath } from "../land/paths.ts";
import { withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";

const ATTEMPTS = 5;

async function untilIndexFree(root: string, args: readonly string[]): Promise<GitResult> {
  for (let attempt = 1; ; attempt += 1) {
    const result = await git(root, args);
    if (result.code === 0 || !result.stderr.includes("index.lock") || attempt === ATTEMPTS) return result;
    await new Promise((done) => setTimeout(done, 150 * attempt));
  }
}

export async function commitRecords(repo: Repo, message: string): Promise<string | null> {
  const { config, root } = repo;
  if (!config.records.commit) return null;
  return withLock(statePath(repo, "locks", "landing.lock"), async () => {
    const added = await untilIndexFree(root, ["add", "--", config.records.dir]);
    if (added.code !== 0) throw new TallyError(`git add -- ${config.records.dir} failed in ${root}:\n${added.stderr.trim()}`);
    const staged = await git(root, ["diff", "--cached", "--quiet", "--", config.records.dir]);
    if (staged.code === 0) return null;
    const identity = ["-c", `user.name=${config.identity.name}`, "-c", `user.email=${config.identity.email}`];
    const committed = await untilIndexFree(root, [...identity, "commit", "-q", "-m", `${config.records.commitPrefix} ${message}`, "--", config.records.dir]);
    if (committed.code !== 0) throw new TallyError(`git commit failed in ${root}:\n${committed.stderr.trim()}`);
    return gitMust(root, ["rev-parse", "--short=7", "HEAD"]);
  });
}
