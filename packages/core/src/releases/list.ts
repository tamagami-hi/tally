import { TallyError } from "../errors.ts";
import { gitOut } from "../git/run.ts";
import { closedLedgers } from "../records/cited.ts";
import type { Ledger } from "../schema/ledger.ts";
import { Records, type Repo } from "../store/records.ts";
import { readReleases, type Release } from "./file.ts";

export const DEFAULT_RELEASES = 10;
const VERSION_MARK = "{version}";

export interface ReleaseTasks {
  count: number;
  milestones: { milestone: string; ids: string[] }[];
}

export type ListedRelease = Release & { tasks: ReleaseTasks; whatsNew?: boolean };

export interface ReleaseList {
  releases: ListedRelease[];
  matched: number;
  unreleased: ReleaseTasks;
}

interface Landed {
  milestone: string;
  id: string;
  commit: string;
}

const landedIn = (ledgers: readonly Ledger[]): Landed[] => ledgers.flatMap((ledger) => ledger.milestones.flatMap((milestone) => milestone.tasks.flatMap((task) => (task.status === "landed" && task.commit !== undefined ? [{ milestone: milestone.id, id: task.id, commit: task.commit }] : []))));

async function commitsBetween(repo: Repo, from: string | undefined, to: string): Promise<string[]> {
  const out = await gitOut(repo.root, ["rev-list", from === undefined ? to : `${from}..${to}`]);
  return out === null || out === "" ? [] : out.split("\n");
}

function counted(landed: readonly Landed[], commits: readonly string[]): ReleaseTasks {
  const inRange = landed.filter((task) => commits.some((full) => full.startsWith(task.commit)));
  const milestones = [...new Set(inRange.map((task) => task.milestone))].map((milestone) => ({ milestone, ids: inRange.filter((task) => task.milestone === milestone).map((task) => task.id) }));
  return { count: inRange.length, milestones };
}

async function whatsNew(repo: Repo, release: Release): Promise<{ whatsNew?: boolean }> {
  const notes = repo.config.releases?.notes;
  if (notes === undefined) return {};
  const path = notes.replaceAll(VERSION_MARK, release.version);
  return { whatsNew: (await gitOut(repo.root, ["cat-file", "-e", `${release.commit}:${path}`])) !== null };
}

function asked(releases: readonly Release[], version: string | undefined): Release[] {
  if (version === undefined) return [...releases];
  const found = releases.filter((one) => one.version === version);
  if (found.length === 0) throw new TallyError(`no release ${version}; recorded: ${releases.map((one) => one.version).reverse().join(", ") || "none"}`);
  return found;
}

export async function listReleases(repo: Repo, ask: { version?: string | undefined; limit?: number | undefined }): Promise<ReleaseList> {
  const { releases } = await readReleases(repo);
  const landed = landedIn([await new Records(repo).readLedger(), ...(await closedLedgers(repo))]);
  const chosen = new Set(asked(releases, ask.version).slice(-(ask.limit ?? DEFAULT_RELEASES)).map((one) => one.version));
  const listed: ListedRelease[] = [];
  for (const [index, release] of releases.entries()) {
    if (!chosen.has(release.version)) continue;
    const commits = await commitsBetween(repo, releases[index - 1]?.commit, release.commit);
    listed.push({ ...release, tasks: counted(landed, commits), ...(await whatsNew(repo, release)) });
  }
  const after = await commitsBetween(repo, releases.at(-1)?.commit, repo.config.mainBranch);
  return { releases: listed.reverse(), matched: chosen.size, unreleased: counted(landed, after) };
}
