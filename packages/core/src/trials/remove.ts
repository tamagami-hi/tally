import { access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { TallyError } from "../errors.ts";
import { git, gitOut } from "../git/run.ts";
import type { Repo } from "../store/records.ts";
import { TRIAL_BRANCH, assertTrialName, trialFolder, trialsFile, withoutTrial, type Trial } from "./file.ts";

export const isThere = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

export const hasBranch = async (repo: Repo, branch: string): Promise<boolean> => (await gitOut(repo.root, ["rev-parse", "--verify", "--quiet", "--end-of-options", `refs/heads/${branch}`])) !== null;

export interface Removed {
  worktree: string;
  branch?: string;
  left: string[];
}

export function assertOwn(repo: Repo, trial: Trial): { folder: string; branch: string } {
  assertTrialName(trial.name);
  const folder = trialFolder(repo, trial.name);
  const branch = `${TRIAL_BRANCH}${trial.name}`;
  if (resolve(trial.worktree) !== folder || trial.branch !== branch) {
    throw new TallyError(`the record of the trial ${trial.name} names the folder ${trial.worktree} and the branch ${trial.branch}, not its own ${folder} and ${branch}; nothing was removed: mend or remove its entry in the service's trials.json`);
  }
  return { folder, branch };
}

async function branchLeft(repo: Repo, branch: string): Promise<string[]> {
  if (!(await hasBranch(repo, branch))) return [];
  const deleted = await git(repo.root, ["branch", "-D", "--end-of-options", branch]);
  return deleted.code === 0 ? [] : [`the branch ${branch}: ${deleted.stderr.trim() || `git branch -D exited ${deleted.code}`}`];
}

export async function removeTrial(repo: Repo, trial: Trial): Promise<Removed> {
  const { folder, branch } = assertOwn(repo, trial);
  if (await isThere(folder)) {
    const removed = await git(repo.root, ["worktree", "remove", "--force", "--force", folder]);
    if (removed.code !== 0) await rm(folder, { recursive: true, force: true });
  }
  await git(repo.root, ["worktree", "prune"]);
  const left = await branchLeft(repo, branch);
  if (left.length === 0) await trialsFile(repo).update((trials) => ({ value: withoutTrial(trials, trial.name), result: undefined }));
  return { worktree: folder, ...(left.length === 0 ? { branch } : {}), left };
}
