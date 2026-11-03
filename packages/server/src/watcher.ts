import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Records, collect, gitOut, listClaims, listLocks, listSessions, statePath, worktrees, type Claim, type HeldLock, type Repo, type Session, type StatusData } from "@tally/core";
import { commitGraph, type LaidCommit } from "./graph.ts";

export interface LiveState {
  sessions: Session[];
  claims: Claim[];
  locks: HeldLock[];
}

export interface Snapshot {
  status: StatusData;
  graph: LaidCommit[];
  state: LiveState;
  takenAt: string;
}

export type Listener = (snapshot: Snapshot) => void;

async function stamp(path: string): Promise<string> {
  try {
    const info = await stat(path);
    return `${info.mtimeMs}:${info.size}`;
  } catch {
    return "none";
  }
}

export async function fingerprint(repo: Repo): Promise<string> {
  const parts: string[] = [(await gitOut(repo.root, ["for-each-ref", "--format=%(refname) %(objectname)"])) ?? ""];
  parts.push((await gitOut(repo.root, ["rev-parse", "--verify", "-q", "origin/main"])) ?? "");
  for (const tree of (await worktrees(repo.root)).values()) {
    parts.push(tree, (await gitOut(tree, ["status", "--porcelain=v1", "--untracked-files=all"])) ?? "");
  }
  parts.push(await stamp(join(repo.recordsDir, "ledger.json")));
  for (const name of ["sessions.json", "claims.json", "locks.json"]) parts.push(await stamp(statePath(repo, name)));
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export async function snapshot(repo: Repo): Promise<Snapshot> {
  const ledger = await new Records(repo).readLedger();
  const status = await collect(repo, ledger);
  const graph = await commitGraph(repo.root);
  const state: LiveState = { sessions: await listSessions(repo), claims: await listClaims(repo), locks: await listLocks(repo) };
  return { status, graph, state, takenAt: new Date().toISOString() };
}

export class Watcher {
  readonly repo: Repo;
  readonly intervalMs: number;
  private listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | undefined;
  private last: string | undefined;
  private latest: Snapshot | undefined;
  private busy = false;

  constructor(repo: Repo, options: { intervalMs?: number } = {}) {
    this.repo = repo;
    this.intervalMs = options.intervalMs ?? 2000;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async current(): Promise<Snapshot> {
    if (this.latest === undefined) {
      this.latest = await snapshot(this.repo);
      this.last = await fingerprint(this.repo);
    }
    return this.latest;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const now = await fingerprint(this.repo);
      if (now !== this.last) {
        this.last = now;
        this.latest = await snapshot(this.repo);
        for (const listener of this.listeners) listener(this.latest);
      }
    } finally {
      this.busy = false;
    }
  }
}
