import type { ClosedCycle, CurrentCycle, CycleList } from "../cycles/list.ts";
import { isAncestor } from "../git/refs.ts";
import type { Repo } from "../store/records.ts";
import { readReleases, type Release } from "./file.ts";

export interface Released {
  version: string;
  commit: string;
}

export interface CycleReleases {
  current: CurrentCycle & { releases?: Released[] };
  closed: (ClosedCycle & { releases?: Released[] })[];
  matched: number;
}

async function within(repo: Repo, releases: readonly Release[], from: string, to: string): Promise<{ releases?: Released[] }> {
  const found: Released[] = [];
  for (const release of releases) {
    if ((await isAncestor(repo.root, release.commit, to)) && !(await isAncestor(repo.root, release.commit, from))) found.push({ version: release.version, commit: release.commit });
  }
  return found.length === 0 ? {} : { releases: found };
}

export async function cycleReleases(repo: Repo, list: CycleList, baseline: string): Promise<CycleReleases> {
  const { releases } = await readReleases(repo);
  if (releases.length === 0) return list;
  const closed = [];
  for (const cycle of list.closed) closed.push({ ...cycle, ...(await within(repo, releases, cycle.from, cycle.to)) });
  return { ...list, current: { ...list.current, ...(await within(repo, releases, baseline, repo.config.mainBranch)) }, closed };
}
