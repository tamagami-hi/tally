import { gitMust } from "./run.ts";

export interface StatusEntry {
  code: string;
  path: string;
  from?: string;
}

const isMove = (code: string): boolean => code.includes("R") || code.includes("C");

export function entriesOf(status: string): StatusEntry[] {
  const tokens = status.split("\0").filter((token) => token !== "");
  const entries: StatusEntry[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";
    const code = token.slice(0, 2);
    const from = isMove(code) ? tokens[index + 1] : undefined;
    entries.push({ code, path: token.slice(3), ...(from === undefined ? {} : { from }) });
    if (isMove(code)) index += 1;
  }
  return entries;
}

export function changedPaths(entries: readonly StatusEntry[]): string[] {
  return entries.flatMap((entry) => (entry.from === undefined ? [entry.path] : [entry.path, entry.from]));
}

export async function statusEntries(cwd: string, more: readonly string[] = []): Promise<StatusEntry[]> {
  return entriesOf(await gitMust(cwd, ["status", "--porcelain=v1", "-z", "--untracked-files=all", ...more]));
}
