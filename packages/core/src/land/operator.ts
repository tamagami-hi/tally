import { posix } from "node:path";
import { TallyError, namedList } from "../errors.ts";
import { currentBranch } from "../git/refs.ts";
import { gitMust, gitOut } from "../git/run.ts";
import { changedPaths, statusEntries } from "../git/status.ts";
import type { Repo } from "../store/records.ts";

export interface CheckoutState {
  branch: string | null;
  changed: string[];
  total: number;
}

const MOST_SHOWN = 20;
const END_OF_NAME = "\0";
const IN_PROGRESS: readonly (readonly [string, string])[] = [["MERGE_HEAD", "a merge"], ["REBASE_HEAD", "a rebase"], ["CHERRY_PICK_HEAD", "a cherry-pick"], ["REVERT_HEAD", "a revert"]];

export const LAND_AGAIN = "commit or stash them there, then land again";
export const CHECKS_PASSED = "its checks passed, so land again once those files are committed or stashed";

const asPath = (name: string): string => posix.normalize(name).replace(/\/+$/, "");

const isSameOrWithin = (path: string, other: string): boolean => path === other || path.startsWith(`${other}/`) || other.startsWith(`${path}/`);

const counted = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`;

export async function operatorChanges(repo: Repo): Promise<string[]> {
  const records = `${repo.config.records.dir}/`;
  const paths = changedPaths(await statusEntries(repo.root)).map(asPath);
  return [...new Set(paths)].filter((path) => !`${path}/`.startsWith(records)).sort();
}

export const BLOCKING = "this landing changes";

export function blockingChanges(changes: readonly string[], landing: readonly string[]): string[] {
  const touched = landing.map(asPath);
  return changes.filter((change) => touched.some((path) => isSameOrWithin(asPath(change), path)));
}

export async function filesChanged(cwd: string, range: string): Promise<string[]> {
  const out = await gitMust(cwd, ["diff", "--name-only", "--no-renames", "-z", range, "--"]);
  return out.split(END_OF_NAME).filter((name) => name !== "");
}

export async function branchChanges(repo: Repo, branch: string): Promise<string[]> {
  if ((await gitOut(repo.root, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`])) === null) return [];
  return filesChanged(repo.root, `${repo.config.mainBranch}...refs/heads/${branch}`);
}

export async function checkoutState(repo: Repo): Promise<CheckoutState> {
  const changed = await operatorChanges(repo);
  const branch = await currentBranch(repo.root);
  return { branch: branch === "" ? null : branch, changed: changed.slice(0, MOST_SHOWN), total: changed.length };
}

export function checkoutLine(repo: Repo, state: CheckoutState): string | undefined {
  if (state.total === 0) return undefined;
  const more = state.total > state.changed.length ? ` and ${state.total - state.changed.length} more` : "";
  return `the operator checkout has ${counted(state.total, "uncommitted file")} outside ${repo.config.records.dir}: ${state.changed.join(", ")}${more}`;
}

export async function checkOnMain(repo: Repo): Promise<void> {
  const branch = await currentBranch(repo.root);
  const main = repo.config.mainBranch;
  if (branch !== main) {
    const on = branch === "" ? "no branch (its HEAD is detached)" : branch;
    throw new TallyError(`the operator checkout at ${repo.root} is on ${on}, not ${main}; check out ${main} there, then land again`);
  }
  for (const [head, what] of IN_PROGRESS) {
    if ((await gitOut(repo.root, ["rev-parse", "--verify", "-q", head])) !== null) throw new TallyError(`the operator checkout at ${repo.root} is in the middle of ${what}; finish it or abort it there, then land again`);
  }
}

export async function checkCheckout(repo: Repo, landing: readonly string[], then = LAND_AGAIN): Promise<void> {
  await checkOnMain(repo);
  const blocking = blockingChanges(await operatorChanges(repo), landing);
  if (blocking.length === 0) return;
  throw new TallyError(`the operator checkout at ${repo.root} has uncommitted changes in ${counted(blocking.length, "file")} ${BLOCKING}: ${namedList(blocking)}; ${then}`);
}
