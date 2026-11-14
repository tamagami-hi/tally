import { TallyError, namedList } from "../errors.ts";
import { currentBranch } from "../git/refs.ts";
import { gitMust } from "../git/run.ts";
import { changedPaths, statusEntries } from "../git/status.ts";
import type { Repo } from "../store/records.ts";

export interface CheckoutState {
  branch: string;
  changed: string[];
  total: number;
}

const MOST_SHOWN = 20;
const END_OF_NAME = "\0";

export const LAND_AGAIN = "commit or stash them there, then land again";
export const CHECKS_PASSED = "its checks passed, so land again once those files are committed or stashed";

const isSameOrWithin = (path: string, other: string): boolean => path === other || path.startsWith(`${other}/`) || other.startsWith(`${path}/`);

const files = (count: number): string => `${count} file${count === 1 ? "" : "s"}`;

export async function operatorChanges(repo: Repo): Promise<string[]> {
  const records = `${repo.config.records.dir}/`;
  const paths = changedPaths(await statusEntries(repo.root));
  return [...new Set(paths)].filter((path) => !path.startsWith(records)).sort();
}

export function blockingChanges(changes: readonly string[], landing: readonly string[]): string[] {
  return changes.filter((change) => landing.some((path) => isSameOrWithin(change, path)));
}

export async function filesChanged(cwd: string, range: string): Promise<string[]> {
  const out = await gitMust(cwd, ["diff", "--name-only", "--no-renames", "-z", range]);
  return out.split(END_OF_NAME).filter((name) => name !== "");
}

export async function checkoutState(repo: Repo): Promise<CheckoutState> {
  const changed = await operatorChanges(repo);
  return { branch: await currentBranch(repo.root), changed: changed.slice(0, MOST_SHOWN), total: changed.length };
}

export function checkoutLine(repo: Repo, state: CheckoutState): string | undefined {
  if (state.total === 0) return undefined;
  const more = state.total > state.changed.length ? ` and ${state.total - state.changed.length} more` : "";
  return `the operator checkout has ${state.total} uncommitted file${state.total === 1 ? "" : "s"} outside ${repo.config.records.dir}: ${state.changed.join(", ")}${more}`;
}

export async function checkOnMain(repo: Repo): Promise<void> {
  const branch = await currentBranch(repo.root);
  const main = repo.config.mainBranch;
  if (branch === main) return;
  const on = branch === "" ? "no branch (its HEAD is detached)" : branch;
  throw new TallyError(`the operator checkout at ${repo.root} is on ${on}, not ${main}; check out ${main} there, then land again`);
}

export async function checkCheckout(repo: Repo, landing: readonly string[], then = LAND_AGAIN): Promise<void> {
  await checkOnMain(repo);
  const blocking = blockingChanges(await operatorChanges(repo), landing);
  if (blocking.length === 0) return;
  throw new TallyError(`the operator checkout at ${repo.root} has uncommitted changes in ${files(blocking.length)} this landing changes: ${namedList(blocking)}; ${then}`);
}
