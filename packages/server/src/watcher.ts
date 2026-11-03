import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Records, collect, gitOut, worktrees, type Repo, type StatusData } from "@tally/core";
import { commitGraph, type LaidCommit } from "./graph.ts";

export interface Snapshot {
  status: StatusData;
  graph: LaidCommit[];
  takenAt: string;
}

export type Listener = (snapshot: Snapshot) => void;

export async function fingerprint(repo: Repo): Promise<string> {
  const parts: string[] = [(await gitOut(repo.root, ["for-each-ref", "--format=%(refname) %(objectname)"])) ?? ""];
  parts.push((await gitOut(repo.root, ["rev-parse", "--verify", "-q", "origin/main"])) ?? "");
  for (const tree of (await worktrees(repo.root)).values()) {
    parts.push(tree, (await gitOut(tree, ["status", "--porcelain=v1", "--untracked-files=all"])) ?? "");
  }
  try {
    const info = await stat(join(repo.recordsDir, "ledger.json"));
    parts.push(String(info.mtimeMs), String(info.size));
  } catch {
    parts.push("no ledger");
  }
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export async function snapshot(repo: Repo): Promise<Snapshot> {
  const ledger = await new Records(repo).readLedger();
  const status = await collect(repo, ledger);
  const graph = await commitGraph(repo.root);
  return { status, graph, takenAt: new Date().toISOString() };
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
