import { ago, gitMust, gitOut, type Config } from "@tally/core";

const SEP = "\u001f";

const ORIGIN = "origin/main";

export const GRAPH_LIMIT = 60;

export interface Commit {
  hash: string;
  parents: string[];
  subject: string;
  author: string;
  ct: number;
  when: string;
  labels: string[];
  pushed: boolean;
}

export type Segment = [number, number];

export interface LaidCommit extends Commit {
  lane: number;
  top: Segment[];
  bottom: Segment[];
  width: number;
}

export function graphBranches(config: Pick<Config, "mainBranch" | "tracks">): string[] {
  return [config.mainBranch, ...config.tracks.map((track) => track.branch)];
}

async function shownRefs(root: string, branches: readonly string[]): Promise<string[]> {
  const wanted = new Set([...branches.map((branch) => `refs/heads/${branch}`), `refs/remotes/${ORIGIN}`]);
  const refs = await gitMust(root, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]);
  return refs.split("\n").filter((ref) => wanted.has(ref));
}

function labelsOf(refs: string, shown: ReadonlySet<string>): string[] {
  const raw = refs.split(",").map((r) => r.trim().replace(/^HEAD -> /, "")).filter((r) => r.length > 0);
  const plain = raw.filter((r) => shown.has(r));
  const tags = raw.filter((r) => r.startsWith("tag: ")).map((r) => r.slice("tag: ".length));
  return [...plain, ...tags];
}

export async function commitCount(root: string, branches: readonly string[]): Promise<number> {
  return Number(await gitMust(root, ["rev-list", "--count", ...(await shownRefs(root, branches))]));
}

export async function commitGraph(root: string, branches: readonly string[], limit = GRAPH_LIMIT, now = Date.now() / 1000): Promise<LaidCommit[]> {
  const shown = new Set([...branches, ORIGIN]);
  const refs = await shownRefs(root, branches);
  const origin = await gitOut(root, ["rev-parse", "--verify", "-q", ORIGIN]);
  const pushed = new Set(origin === null ? [] : ((await gitOut(root, ["rev-list", "--abbrev-commit", "--abbrev=7", ORIGIN])) ?? "").split(/\s+/));
  const format = `%h${SEP}%p${SEP}%s${SEP}%an${SEP}%ct${SEP}%D`;
  const out = await gitMust(root, ["log", "--date-order", "--abbrev=7", `-n${limit}`, `--format=${format}`, ...refs]);
  const commits: Commit[] = out.split("\n").filter((l) => l.length > 0).map((line) => {
    const [hash = "", parents = "", subject = "", author = "", ct = "0", names = ""] = line.split(SEP, 6);
    return { hash, parents: parents.split(" ").filter((p) => p.length > 0), subject, author, ct: Number(ct), when: ago(Number(ct), now), labels: labelsOf(names, shown), pushed: pushed.has(hash) };
  });
  return layOut(commits);
}

export function layOut(commits: readonly Commit[]): LaidCommit[] {
  const lanes: (string | null)[] = [];
  const laid: LaidCommit[] = [];
  for (const commit of commits) {
    const known = lanes.includes(commit.hash);
    let lane: number;
    if (known) lane = lanes.indexOf(commit.hash);
    else if (lanes.includes(null)) {
      lane = lanes.indexOf(null);
      lanes[lane] = commit.hash;
    } else {
      lane = lanes.length;
      lanes.push(commit.hash);
    }
    const before = [...lanes];
    const top: Segment[] = before.flatMap((v, k): Segment[] => (v !== null && v !== commit.hash ? [[k, k]] : []));
    top.push(...before.flatMap((v, k): Segment[] => (v === commit.hash && (k !== lane || known) ? [[k, lane]] : [])));
    for (let k = 0; k < lanes.length; k += 1) if (lanes[k] === commit.hash) lanes[k] = null;
    const bottom: Segment[] = lanes.flatMap((v, k): Segment[] => (v !== null ? [[k, k]] : []));
    commit.parents.forEach((parent, n) => {
      let target: number;
      if (lanes.includes(parent)) target = lanes.indexOf(parent);
      else if (n === 0) {
        target = lane;
        lanes[lane] = parent;
      } else if (lanes.includes(null)) {
        target = lanes.indexOf(null);
        lanes[target] = parent;
      } else {
        target = lanes.length;
        lanes.push(parent);
      }
      bottom.push([lane, target]);
    });
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop();
    laid.push({ ...commit, lane, top, bottom, width: Math.max(before.length, lanes.length, lane + 1) });
  }
  return laid;
}
