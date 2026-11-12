import { stat } from "node:fs/promises";
import { join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { listSessions, type Session } from "../state/sessions.ts";
import { CONFIG_FILE, RECORDS_DIR, openRepo, type Repo } from "../store/records.ts";
import { rootOfWorktree } from "./find.ts";
import { entryForRoot } from "./lookup.ts";
import { listPath, stateDirOf } from "./home.ts";
import { readRepoList, unknownRepo, type RepoEntry, type RepoList } from "./list.ts";

const MISSING = "missing";

interface Loaded {
  root: string;
  stamp: string;
  repo: Repo;
  problem?: string;
}

export interface SessionHome {
  repo: Repo;
  session: Session;
}

async function stampOf(path: string): Promise<string> {
  try {
    const { mtimeMs, size } = await stat(path);
    return `${mtimeMs}:${size}`;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return MISSING;
    throw error;
  }
}

export class Repos {
  readonly home: string;
  private listStamp: string | undefined;
  private list: RepoList = { schema: 1, repos: [] };
  private loaded: ReadonlyMap<string, Loaded> = new Map();

  constructor(home: string) {
    this.home = home;
  }

  async entries(): Promise<RepoEntry[]> {
    return (await this.current()).repos;
  }

  async defaultName(): Promise<string | undefined> {
    return (await this.current()).default;
  }

  async get(name: string): Promise<Repo> {
    const list = await this.current();
    const entry = list.repos.find((repo) => repo.name === name);
    if (entry === undefined) throw unknownRepo(name, list);
    return this.open(entry);
  }

  async default(): Promise<Repo> {
    const name = await this.defaultName();
    if (name === undefined) throw new TallyError("no repository is listed yet; add one in the sidebar");
    return this.get(name);
  }

  async forPath(path: string): Promise<Repo> {
    const root = await rootOfWorktree(path);
    return this.open(entryForRoot(await this.current(), root));
  }

  async ofSession(sessionId: string): Promise<SessionHome> {
    for (const entry of await this.entries()) {
      const session = (await listSessions({ stateDir: stateDirOf(this.home, entry.name) })).find((s) => s.id === sessionId);
      if (session !== undefined) return { repo: await this.open(entry), session };
    }
    throw new TallyError(`no session ${sessionId}; open one with session_open`);
  }

  problem(name: string): string | undefined {
    return this.loaded.get(name)?.problem;
  }

  private async current(): Promise<RepoList> {
    const stamp = await stampOf(listPath(this.home));
    if (stamp === this.listStamp) return this.list;
    const list = await readRepoList(this.home);
    const roots = new Map(list.repos.map((repo) => [repo.name, repo.root]));
    this.loaded = new Map([...this.loaded].filter(([name, loaded]) => roots.get(name) === loaded.root));
    this.list = list;
    this.listStamp = stamp;
    return list;
  }

  private async open(entry: RepoEntry): Promise<Repo> {
    const stamp = await stampOf(join(entry.root, RECORDS_DIR, CONFIG_FILE));
    const cached = this.loaded.get(entry.name);
    if (cached !== undefined && cached.stamp === stamp) return cached.repo;
    try {
      const repo = await openRepo(entry.root, { name: entry.name, stateDir: stateDirOf(this.home, entry.name) });
      this.keep(entry.name, { root: entry.root, stamp, repo });
      return repo;
    } catch (error: unknown) {
      if (!(error instanceof TallyError) || cached === undefined) throw error;
      this.keep(entry.name, { root: cached.root, stamp, repo: cached.repo, problem: messageOf(error) });
      return cached.repo;
    }
  }

  private keep(name: string, loaded: Loaded): void {
    this.loaded = new Map([...this.loaded, [name, loaded]]);
  }
}
