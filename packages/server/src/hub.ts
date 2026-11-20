import { messageOf, type Repos } from "@tally/core";
import type { Served } from "./repo-api.ts";
import { DEFAULT_INTERVAL_MS, Watcher } from "./watcher.ts";

export interface RepoSummary {
  name: string;
  root: string;
  project: string;
  isDefault: boolean;
  sessions: number;
  locks: number;
  questions: number;
  problems: number;
  overall: number;
  problem?: string;
}

interface Watched {
  root: string;
  watcher: Watcher;
}

export class Hub {
  readonly repos: Repos;
  private readonly intervalMs: number | undefined;
  private watched: ReadonlyMap<string, Watched> = new Map();
  private listTimer: NodeJS.Timeout | undefined;

  constructor(repos: Repos, options: { intervalMs?: number } = {}) {
    this.repos = repos;
    this.intervalMs = options.intervalMs;
  }

  async get(name: string): Promise<Served> {
    const repo = await this.repos.get(name);
    return { repo, watcher: await this.watcherOf(repo.name, repo.root) };
  }

  async default(): Promise<Served> {
    const repo = await this.repos.default();
    return { repo, watcher: await this.watcherOf(repo.name, repo.root) };
  }

  async overview(): Promise<RepoSummary[]> {
    await this.sync();
    const chosen = await this.repos.defaultName();
    const rows: RepoSummary[] = [];
    for (const entry of await this.repos.entries()) {
      rows.push(await this.summary(entry.name, entry.root, entry.name === chosen));
    }
    return rows;
  }

  async sync(): Promise<void> {
    const roots = new Map((await this.repos.entries()).map((entry) => [entry.name, entry.root]));
    const gone = [...this.watched].filter(([name, watched]) => roots.get(name) !== watched.root);
    this.watched = new Map([...this.watched].filter(([name, watched]) => roots.get(name) === watched.root));
    await Promise.all(gone.map(([, watched]) => watched.watcher.stop()));
  }

  start(): void {
    if (this.listTimer !== undefined) return;
    void this.watchAll();
    this.listTimer = setInterval(() => void this.watchAll(), this.intervalMs ?? DEFAULT_INTERVAL_MS);
    this.listTimer.unref();
  }

  async watchAll(): Promise<void> {
    try {
      await this.sync();
      for (const entry of await this.repos.entries()) await this.watcherOf(entry.name, entry.root);
    } catch (error: unknown) {
      process.stderr.write(`tally could not start watching its listed repositories: ${messageOf(error)}\n`);
    }
  }

  async stop(): Promise<void> {
    if (this.listTimer !== undefined) clearInterval(this.listTimer);
    this.listTimer = undefined;
    const all = [...this.watched.values()];
    this.watched = new Map();
    await Promise.all(all.map((watched) => watched.watcher.stop()));
  }

  private async summary(name: string, root: string, isDefault: boolean): Promise<RepoSummary> {
    const empty = { name, root, project: "", isDefault, sessions: 0, locks: 0, questions: 0, problems: 0, overall: 0 };
    try {
      const { repo, watcher } = await this.get(name);
      const { status, state } = await watcher.current();
      const problem = this.repos.problem(name) ?? watcher.lastFailure;
      return { ...empty, project: repo.config.name, sessions: state.sessions.length, locks: state.locks.length, questions: status.questions.length, problems: status.problems.length, overall: status.overall, ...(problem === undefined ? {} : { problem }) };
    } catch (error: unknown) {
      return { ...empty, problem: messageOf(error) };
    }
  }

  private async watcherOf(name: string, root: string): Promise<Watcher> {
    const known = this.watched.get(name);
    if (known !== undefined && known.root === root) return known.watcher;
    if (known !== undefined) await known.watcher.stop();
    const watcher = new Watcher(() => this.repos.get(name), this.intervalMs === undefined ? {} : { intervalMs: this.intervalMs });
    watcher.start();
    this.watched = new Map([...this.watched, [name, { root, watcher }]]);
    return watcher;
  }
}
