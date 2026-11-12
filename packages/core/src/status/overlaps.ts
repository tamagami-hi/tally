import { gitOut } from "../git/run.ts";
import { worktreeOf } from "../land/paths.ts";
import type { Repo } from "../store/records.ts";

export interface Overlap {
  file: string;
  tracks: string[];
}

export interface OverlapWith {
  file: string;
  with: string[];
}

const RENAMED = /[RC]/;

const entries = (text: string | null): string[] => (text === null ? [] : text.split("\0").filter((entry) => entry !== ""));

function openPaths(status: string | null): string[] {
  const parts = entries(status);
  const paths: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index] ?? "";
    paths.push(entry.slice(3));
    if (RENAMED.test(entry.slice(0, 2))) index += 1;
  }
  return paths;
}

export async function changedFiles(repo: Repo, name: string): Promise<string[]> {
  const track = repo.config.tracks.find((one) => one.name === name);
  if (track === undefined) return [];
  const [ahead, open] = await Promise.all([
    gitOut(repo.root, ["diff", "--name-only", "-z", `${repo.config.mainBranch}...${track.branch}`]),
    gitOut(worktreeOf(repo, track), ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  return [...new Set([...entries(ahead), ...openPaths(open)])].sort();
}

export async function overlaps(repo: Repo): Promise<Overlap[]> {
  const changed = await Promise.all(repo.config.tracks.map(async (track) => ({ track: track.name, files: await changedFiles(repo, track.name) })));
  const holders = new Map<string, string[]>();
  for (const { track, files } of changed) {
    for (const file of files) holders.set(file, [...(holders.get(file) ?? []), track]);
  }
  return [...holders].filter(([, tracks]) => tracks.length > 1).map(([file, tracks]) => ({ file, tracks: [...tracks].sort() })).sort((a, b) => a.file.localeCompare(b.file));
}

export async function overlapsOf(repo: Repo, name: string): Promise<OverlapWith[]> {
  return (await overlaps(repo)).filter((overlap) => overlap.tracks.includes(name)).map((overlap) => ({ file: overlap.file, with: overlap.tracks.filter((track) => track !== name) }));
}
