import type { DrawnCommit, LaidCommit, Stroke } from "./types.ts";

const MAIN_LANE = 0;

interface Held {
  hash: string;
  branch: string | null;
}

type Lanes = (Held | null)[];

function trunkOf(commits: readonly LaidCommit[], main: string): Set<string> {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const trunk = new Set<string>();
  for (let at = commits.find((c) => c.labels.includes(main)); at !== undefined; at = byHash.get(at.parents[0] ?? "")) trunk.add(at.hash);
  return trunk;
}

function freeLane(lanes: Lanes): number {
  const free = lanes.indexOf(null, MAIN_LANE + 1);
  return free === -1 ? lanes.length : free;
}

function sideLane(lanes: Lanes, hash: string): number {
  const held = lanes.findIndex((lane) => lane?.hash === hash);
  return held === -1 ? freeLane(lanes) : held;
}

const straight = (lanes: Lanes): Stroke[] => lanes.flatMap((held, k) => (held === null ? [] : [{ from: k, to: k, branch: held.branch }]));

function withLane(lanes: Lanes, at: number, held: Held): Lanes {
  return Array.from({ length: Math.max(lanes.length, at + 1) }, (_, k) => (k === at ? held : (lanes[k] ?? null)));
}

function holdParents(lanes: Lanes, parents: readonly string[], lane: number, branch: string | null): { held: Lanes; strokes: Stroke[] } {
  const start: { held: Lanes; strokes: Stroke[] } = { held: lanes, strokes: [] };
  return parents.reduce(({ held, strokes }, parent, n) => {
    const target = n === 0 ? lane : sideLane(held, parent);
    const owner = n === 0 ? { hash: parent, branch } : (held[target] ?? { hash: parent, branch: null });
    return { held: withLane(held, target, owner), strokes: [...strokes, { from: lane, to: target, branch: owner.branch }] };
  }, start);
}

function trimmed(lanes: Lanes): Lanes {
  const last = lanes.findLastIndex((held) => held !== null);
  return lanes.slice(0, Math.max(last, MAIN_LANE) + 1);
}

export function forkLanes(commits: readonly LaidCommit[], main: string, branches: readonly string[]): DrawnCommit[] {
  const trunk = trunkOf(commits, main);
  const drawn: DrawnCommit[] = [];
  let lanes: Lanes = [null];
  for (const commit of commits) {
    const onTrunk = trunk.has(commit.hash);
    const lane = onTrunk ? MAIN_LANE : sideLane(lanes, commit.hash);
    const branch = onTrunk ? main : (commit.labels.find((label) => branches.includes(label)) ?? lanes[lane]?.branch ?? null);
    const top = lanes.flatMap((held, k): Stroke[] => (held === null ? [] : [{ from: k, to: held.hash === commit.hash ? lane : k, branch: held.branch }]));
    const rest = lanes.map((held) => (held?.hash === commit.hash ? null : held));
    const { held, strokes } = holdParents(rest, commit.parents, lane, branch);
    const next = trimmed(held);
    drawn.push({ ...commit, lane, branch, top, bottom: [...straight(rest), ...strokes], width: Math.max(lanes.length, next.length, lane + 1) });
    lanes = next;
  }
  return drawn;
}
