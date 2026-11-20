import { gitOut } from "../git/run.ts";
import { taskAt } from "../ledger/refs.ts";
import type { Ledger } from "../schema/ledger.ts";
import { Records, type Repo } from "../store/records.ts";

export interface AheadTrack {
  name: string;
  commits: number;
  files: string[];
  overlaps: string[];
}

export interface Place {
  track: string;
  reason: string;
}

export interface LandOrder {
  ahead: AheadTrack[];
  landOrder: Place[];
  suggestion: true;
}

async function aheadOf(repo: Repo, name: string, branch: string): Promise<Omit<AheadTrack, "overlaps"> | undefined> {
  const main = repo.config.mainBranch;
  const commits = Number((await gitOut(repo.root, ["rev-list", "--count", `${main}..${branch}`])) ?? "0");
  if (!Number.isInteger(commits) || commits === 0) return undefined;
  const files = ((await gitOut(repo.root, ["diff", "-z", "--name-only", "--no-renames", `${main}...${branch}`])) ?? "").split("\0").filter((file) => file !== "").sort();
  return { name, commits, files };
}

function waitedOn(ledger: Ledger): Map<string, string[]> {
  const waited = new Map<string, string[]>();
  const add = (track: string, label: string): void => { waited.set(track, [...(waited.get(track) ?? []), label]); };
  for (const milestone of ledger.milestones) {
    for (const task of milestone.tasks.filter((one) => one.status !== "landed")) {
      const label = `${milestone.id} '${task.id}'`;
      const onTasks = (task.waitsOn ?? []).flatMap((wait) => (wait.task === undefined ? [] : [taskAt(ledger, wait.task)])).filter((target) => target !== undefined && target.status !== "landed").map((target) => target?.track ?? "");
      const onMilestone = task.waits === undefined ? [] : (ledger.milestones.find((one) => one.id === task.waits)?.track.split("+") ?? []);
      for (const track of new Set([...onTasks, ...onMilestone])) if (track !== task.track) add(track, label);
    }
  }
  return waited;
}

const bySize = (a: AheadTrack, b: AheadTrack): number => a.files.length - b.files.length || a.commits - b.commits || a.name.localeCompare(b.name);

const filesText = (n: number): string => `${n} changed file${n === 1 ? "" : "s"}`;

function placed(ahead: readonly AheadTrack[], waited: ReadonlyMap<string, string[]>): Place[] {
  const first = ahead.filter((track) => waited.has(track.name)).sort(bySize);
  const alone = ahead.filter((track) => !waited.has(track.name) && track.overlaps.length === 0).sort(bySize);
  const overlapping = ahead.filter((track) => !waited.has(track.name) && track.overlaps.length > 0).sort(bySize);
  return [
    ...first.map((track) => ({ track: track.name, reason: `others wait on it: ${(waited.get(track.name) ?? []).join(", ")}` })),
    ...alone.map((track) => ({ track: track.name, reason: "it overlaps no other track ahead of main" })),
    ...overlapping.map((track) => ({ track: track.name, reason: `it overlaps ${track.overlaps.join(", ")}; ${filesText(track.files.length)}` })),
  ];
}

export async function landOrder(repo: Repo): Promise<LandOrder> {
  const found: Omit<AheadTrack, "overlaps">[] = [];
  for (const track of repo.config.tracks) {
    const one = await aheadOf(repo, track.name, track.branch);
    if (one !== undefined) found.push(one);
  }
  const ahead = found.map((track) => ({ ...track, overlaps: found.filter((other) => other.name !== track.name && other.files.some((file) => track.files.includes(file))).map((other) => other.name) }));
  return { ahead, landOrder: placed(ahead, waitedOn(await new Records(repo).readLedger())), suggestion: true };
}
