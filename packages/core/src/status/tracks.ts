import { relative } from "node:path";
import { porcelain, revCount, worktrees } from "../git/refs.ts";
import { gitMust, gitOut } from "../git/run.ts";
import { ago } from "./summary.ts";

const SEP = "\u001f";

export interface ChangedFile {
  status: string;
  path: string;
  add: string;
  del: string;
}

export interface TrackRow {
  branch: string;
  track: string;
  path: string;
  head: string;
  subject: string;
  ct: number;
  when: string;
  ahead: number;
  behind: number;
  dirty: number;
  files: ChangedFile[];
  isMain: boolean;
}

export async function changes(tree: string): Promise<ChangedFile[]> {
  const counts = new Map<string, [string, string]>();
  for (const line of ((await gitOut(tree, ["diff", "--numstat", "HEAD"])) ?? "").split("\n")) {
    const [add, del, ...path] = line.split("\t");
    if (add !== undefined && del !== undefined && path.length > 0) counts.set(path.join("\t"), [add, del]);
  }
  return (await porcelain(tree)).map((line) => {
    const code = line.slice(0, 2);
    let path = line.slice(3);
    if (path.includes(" -> ")) path = path.split(" -> ", 2)[1] ?? path;
    const mark = code === "??" ? "??" : (code.trim() || "M")[0] ?? "M";
    const [add, del] = counts.get(path) ?? ["", ""];
    return { status: mark, path, add, del };
  });
}

export async function branches(root: string, mainBranch: string, now = Date.now() / 1000): Promise<TrackRow[]> {
  const trees = await worktrees(root);
  const refs = await gitMust(root, ["for-each-ref", "--sort=-committerdate", `--format=%(refname:short)${SEP}%(objectname:short)${SEP}%(committerdate:unix)${SEP}%(subject)`, "refs/heads"]);
  const rows: TrackRow[] = [];
  for (const line of refs.split("\n").filter((l) => l.length > 0)) {
    const [name = "", head = "", ct = "0", subject = ""] = line.split(SEP, 4);
    const tree = trees.get(name);
    if (tree === undefined) continue;
    const files = await changes(tree);
    rows.push({
      branch: name,
      track: name.replace(/^track\//, ""),
      path: tree === root ? "." : relative(root, tree),
      head,
      subject,
      ct: Number(ct),
      when: ago(Number(ct), now),
      ahead: await revCount(root, `${mainBranch}..${name}`),
      behind: await revCount(root, `${name}..${mainBranch}`),
      dirty: files.length,
      files,
      isMain: name === mainBranch,
    });
  }
  const key = (r: TrackRow): string => `${r.isMain ? 0 : 1}${r.branch}`;
  return rows.sort((a, b) => key(a).localeCompare(key(b)));
}

export function relativeTo(root: string, path: string): string {
  return path === "" || path === "." ? path : relative(root, path) || ".";
}
