import { TallyError } from "../errors.ts";
import type { ResolveCommit } from "../ledger/ops.ts";
import { git, gitMust, gitOut } from "./run.ts";

export async function verifyCommit(cwd: string, ref: string): Promise<string | null> {
  return gitOut(cwd, ["rev-parse", "--verify", "-q", `${ref}^{commit}`]);
}

export async function isAncestor(cwd: string, commit: string, ref: string): Promise<boolean> {
  return (await git(cwd, ["merge-base", "--is-ancestor", commit, ref])).code === 0;
}

export async function shortOf(cwd: string, sha: string, length = 7): Promise<string> {
  return gitMust(cwd, ["rev-parse", `--short=${length}`, sha]);
}

export function resolveOnMain(cwd: string, mainBranch: string): ResolveCommit {
  return async (commit) => {
    const full = await verifyCommit(cwd, commit);
    if (full === null) throw new TallyError(`${commit}: no such commit`);
    if (!(await isAncestor(cwd, full, mainBranch))) {
      throw new TallyError(`${commit} is not on main yet; record it after it lands`);
    }
    return shortOf(cwd, full);
  };
}

export async function logLines(cwd: string, range: string, format = "%h %s"): Promise<string[]> {
  const out = await gitOut(cwd, ["log", `--format=${format}`, "--abbrev=7", range]);
  return out === null || out === "" ? [] : out.split("\n");
}

export async function currentBranch(cwd: string): Promise<string> {
  return gitMust(cwd, ["branch", "--show-current"]);
}

export async function porcelain(cwd: string): Promise<string[]> {
  const out = await gitMust(cwd, ["status", "--porcelain=v1", "--untracked-files=all"]);
  return out === "" ? [] : out.split("\n");
}

export async function worktrees(cwd: string): Promise<Map<string, string>> {
  const out = await gitMust(cwd, ["worktree", "list", "--porcelain"]);
  const found = new Map<string, string>();
  let path: string | undefined;
  for (const line of [...out.split("\n"), ""]) {
    if (line === "") {
      path = undefined;
      continue;
    }
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    if (key === "worktree") path = value;
    if (key === "branch" && path !== undefined) found.set(value.replace(/^refs\/heads\//, ""), path);
  }
  return found;
}

export async function revCount(cwd: string, range: string): Promise<number> {
  const out = await gitOut(cwd, ["rev-list", "--count", range]);
  return out === null ? 0 : Number(out);
}
