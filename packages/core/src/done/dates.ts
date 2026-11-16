import { gitOut } from "../git/run.ts";
import type { Repo } from "../store/records.ts";

const PREFIX = 7;

export type CommitDates = ReadonlyMap<string, readonly (readonly [string, string])[]>;

function parsed(line: string): readonly [string, string] | undefined {
  const [hash = "", date = ""] = line.split(" ");
  const at = Date.parse(date);
  return hash.length < PREFIX || Number.isNaN(at) ? undefined : [hash, new Date(at).toISOString()];
}

export async function commitDates(repo: Repo, baseline: string): Promise<CommitDates> {
  const out = await gitOut(repo.root, ["log", "--format=%H %cI", `${baseline}..${repo.config.mainBranch}`]);
  const dated = (out ?? "").split("\n").flatMap((line) => {
    const pair = parsed(line);
    return pair === undefined ? [] : [pair];
  });
  return dated.reduce((dates, pair) => {
    const key = pair[0].slice(0, PREFIX);
    return dates.set(key, [...(dates.get(key) ?? []), pair]);
  }, new Map<string, (readonly [string, string])[]>());
}

export function dateOf(dates: CommitDates, commit: string): string | undefined {
  const wanted = commit.toLowerCase();
  return dates.get(wanted.slice(0, PREFIX))?.find(([hash]) => hash.startsWith(wanted))?.[1];
}
