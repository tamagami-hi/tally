import { TallyError } from "../errors.ts";
import { git, gitMust } from "../git/run.ts";
import { statePath } from "../land/paths.ts";
import { withLock } from "../store/lock.ts";
import type { Repo } from "../store/records.ts";

export async function commitRecords(repo: Repo, message: string): Promise<string | null> {
  const { config, root } = repo;
  if (!config.records.commit) return null;
  return withLock(statePath(repo, "locks", "landing.lock"), async () => {
    await gitMust(root, ["add", "--", config.records.dir]);
    const staged = await git(root, ["diff", "--cached", "--quiet", "--", config.records.dir]);
    if (staged.code === 0) return null;
    const identity = ["-c", `user.name=${config.identity.name}`, "-c", `user.email=${config.identity.email}`];
    for (let attempt = 1; ; attempt += 1) {
      const result = await git(root, [...identity, "commit", "-q", "-m", `${config.records.commitPrefix} ${message}`, "--", config.records.dir]);
      if (result.code === 0) break;
      if (!result.stderr.includes("index.lock") || attempt === 5) throw new TallyError(`git commit failed in ${root}:\n${result.stderr.trim()}`);
      await new Promise((done) => setTimeout(done, 150 * attempt));
    }
    return gitMust(root, ["rev-parse", "--short=7", "HEAD"]);
  });
}
