import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { CloseBusy, Records, advance, finishPendingClose, closeIdleSessions, closeIdleTracks, collect, flushPendingPhase, isActive, queueFile, evidenceFiles, manualFiles, gitOut, listClaims, listLocks, listSessions, messageOf, statePath, takeResults, worktrees, type Claim, type HeldLock, type Repo, type Session, type StatusData } from "@tally/core";
import { commitCount, commitGraph, graphBranches, type LaidCommit } from "./graph.ts";

export interface QueuedLanding {
  ticket: string;
  track: string;
  agent: string;
  state: "queued" | "turn";
  since: string;
}

export interface LiveState {
  sessions: Session[];
  claims: Claim[];
  locks: HeldLock[];
  queue: QueuedLanding[];
}

export interface Snapshot {
  status: StatusData;
  graph: LaidCommit[];
  graphTotal: number;
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
  parts.push(await stamp(join(repo.recordsDir, "ledger.json")), await stamp(join(repo.recordsDir, "phases.json")));
  for (const path of [...(await evidenceFiles(repo)), ...(await manualFiles(repo))]) parts.push(path, await stamp(path));
  for (const name of ["sessions.json", "claims.json", "locks.json", "queue.json"]) parts.push(await stamp(statePath(repo, name)));
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

async function landings(repo: Repo): Promise<QueuedLanding[]> {
  const waiting = (await queueFile(repo).read()).tickets.filter(isActive);
  return waiting.map((ticket) => ({ ticket: ticket.id, track: ticket.track, agent: ticket.agent, state: ticket.state === "turn" ? "turn" : "queued", since: ticket.turn?.startedAt ?? ticket.since }));
}

export async function snapshot(repo: Repo): Promise<Snapshot> {
  const ledger = await new Records(repo).readLedger();
  const status = await collect(repo, ledger);
  const branches = graphBranches(repo.config);
  const graph = await commitGraph(repo.root, branches);
  const graphTotal = await commitCount(repo.root, branches);
  const state: LiveState = { sessions: await listSessions(repo), claims: await listClaims(repo), locks: await listLocks(repo), queue: await landings(repo) };
  return { status, graph, graphTotal, state, takenAt: new Date().toISOString() };
}

export type RepoGetter = () => Promise<Repo>;

export const PROBLEM_HOLD_MS = 60 * 60 * 1000;
export const DEFAULT_INTERVAL_MS = 2_000;

interface Held {
  text: string;
  until: number;
}

export class Watcher {
  readonly intervalMs: number;
  private readonly source: RepoGetter;
  private listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | undefined;
  private last: string | undefined;
  private latest: Snapshot | undefined;
  private busy = false;
  private inFlight: Promise<void> = Promise.resolve();
  private failure: string | undefined;
  private held: readonly Held[] = [];
  private readonly holdMs: number;
  private halt: () => void = () => undefined;
  readonly stopped = new Promise<void>((done) => {
    this.halt = done;
  });

  constructor(repo: Repo | RepoGetter, options: { intervalMs?: number; holdMs?: number } = {}) {
    this.source = typeof repo === "function" ? repo : () => Promise.resolve(repo);
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.holdMs = options.holdMs ?? PROBLEM_HOLD_MS;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async current(): Promise<Snapshot> {
    if (this.latest === undefined) {
      const repo = await this.source();
      this.latest = await snapshot(repo);
      this.last = await fingerprint(repo);
    }
    return this.latest;
  }

  start(): void {
    if (this.timer !== undefined) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
    this.halt();
    await this.inFlight;
  }

  get lastFailure(): string | undefined {
    return this.failure;
  }

  private hold(problems: readonly string[]): string[] {
    const now = Date.now();
    this.held = [...this.held.filter((one) => one.until > now), ...problems.map((text) => ({ text, until: now + this.holdMs }))];
    return this.held.map((one) => one.text);
  }

  private failing(problems: readonly string[]): string | undefined {
    const all = [...this.hold([]), ...problems];
    return all.length === 0 ? undefined : all.join("; ");
  }

  private tick(): Promise<void> {
    if (this.busy) return this.inFlight;
    this.busy = true;
    this.inFlight = (async () => {
      try {
        const repo = await this.source();
        await finishPendingClose(repo);
        await takeResults(repo);
        this.hold((await closeIdleSessions(repo)).problems);
        const idle = await closeIdleTracks(repo);
        await advance(repo);
        await flushPendingPhase(repo);
        const now = await fingerprint(repo);
        if (now !== this.last) {
          const fresh = await snapshot(repo);
          this.last = now;
          this.latest = fresh;
          for (const listener of this.listeners) listener(fresh);
        }
        this.failure = this.failing(idle.problems);
      } catch (error: unknown) {
        if (!(error instanceof CloseBusy)) this.failure = this.failing([messageOf(error)]);
      } finally {
        this.busy = false;
      }
    })();
    return this.inFlight;
  }
}
