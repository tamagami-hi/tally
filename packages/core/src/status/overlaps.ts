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

const pathOf = (line: string): string => {
  const path = line.slice(3);
  return path.includes(" -> ") ? (path.split(" -> ", 2)[1] ?? path) : path;
};

const lines = (text: string | null): string[] => (text === null ? [] : text.split("\n").filter((line) => line !== ""));

export async function changedFiles(repo: Repo, name: string): Promise<string[]> {
  const track = repo.config.tracks.find((one) => one.name === name);
  if (track === undefined) return [];
  const ahead = lines(await gitOut(repo.root, ["diff", "--name-only", `${repo.config.mainBranch}...${track.branch}`]));
  const open = lines(await gitOut(worktreeOf(repo, track), ["status", "--porcelain=v1", "--untracked-files=all"])).map(pathOf);
  return [...new Set([...ahead, ...open])].sort();
}

export async function overlaps(repo: Repo): Promise<Overlap[]> {
  const holders = new Map<string, string[]>();
  for (const track of repo.config.tracks) {
    for (const file of await changedFiles(repo, track.name)) holders.set(file, [...(holders.get(file) ?? []), track.name]);
  }
  return [...holders].filter(([, tracks]) => tracks.length > 1).map(([file, tracks]) => ({ file, tracks: [...tracks].sort() })).sort((a, b) => a.file.localeCompare(b.file));
}

export async function overlapsOf(repo: Repo, name: string): Promise<OverlapWith[]> {
  return (await overlaps(repo)).filter((overlap) => overlap.tracks.includes(name)).map((overlap) => ({ file: overlap.file, with: overlap.tracks.filter((track) => track !== name) }));
}
