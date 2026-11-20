import { access, rm } from "node:fs/promises";
import { git, gitOut } from "../git/run.ts";
import type { Repo } from "../store/records.ts";
import { trialsFile, withoutTrial, type Trial } from "./file.ts";

export const isThere = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

export const hasBranch = async (repo: Repo, branch: string): Promise<boolean> => (await gitOut(repo.root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])) !== null;

export async function removeTrial(repo: Repo, trial: Trial): Promise<void> {
  if (await isThere(trial.worktree)) {
    const removed = await git(repo.root, ["worktree", "remove", "--force", "--force", trial.worktree]);
    if (removed.code !== 0) await rm(trial.worktree, { recursive: true, force: true });
  }
  await git(repo.root, ["worktree", "prune"]);
  if (await hasBranch(repo, trial.branch)) await git(repo.root, ["branch", "-D", trial.branch]);
  await trialsFile(repo).update((trials) => ({ value: withoutTrial(trials, trial.name), result: undefined }));
}
