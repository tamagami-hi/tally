import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { TallyError, messageOf } from "../errors.ts";
import { listSessions, type Session } from "../state/sessions.ts";
import { CONFIG_FILE, RECORDS_DIR, openRepo, type Repo } from "../store/records.ts";
import { rootOfWorktree } from "./find.ts";
import { listPath, stateDirOf } from "./home.ts";
import { readRepoList, unknownRepo, type RepoEntry, type RepoList } from "./list.ts";
import { entryForRoot } from "./lookup.ts";

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
    const { mtimeNs, ctimeNs, size, ino } = await stat(path, { bigint: true });
    return `${mtimeNs}:${ctimeNs}:${size}:${ino}`;
  } catch (error: unknown) {
    return `unreadable:${(error as NodeJS.ErrnoException).code ?? "unknown"}`;
  }
}

async function isGone(folder: string): Promise<boolean> {
  try {
    await access(folder);
    return false;
  } catch {
    return true;
  }
}

export class Repos {
  readonly home: string;
  private listStamp: string | undefined;
  private listTrouble: string | undefined;
  private list: RepoList = { schema: 1, repos: [] };
  private loaded: ReadonlyMap<string, Loaded> = new Map();
  private troubles: ReadonlyMap<string, string> = new Map();

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
      const session = await this.sessionIn(entry, sessionId);
      if (session !== undefined) return { repo: await this.open(entry), session };
    }
    throw new TallyError(`no session ${sessionId}; open one with session_open`);
  }

  problem(name: string): string | undefined {
    return this.loaded.get(name)?.problem ?? this.troubles.get(name);
  }

  listProblem(): string | undefined {
    return this.listTrouble;
  }

  private async sessionIn(entry: RepoEntry, sessionId: string): Promise<Session | undefined> {
    try {
      return (await listSessions({ stateDir: stateDirOf(this.home, entry.name) })).find((session) => session.id === sessionId);
    } catch (error: unknown) {
      if (!(error instanceof TallyError)) throw error;
      this.trouble(entry.name, messageOf(error));
      return undefined;
    }
  }

  private async current(): Promise<RepoList> {
    const stamp = await stampOf(listPath(this.home));
    if (stamp === this.listStamp) return this.list;
    try {
      const list = await readRepoList(this.home);
      const roots = new Map(list.repos.map((repo) => [repo.name, repo.root]));
      this.loaded = new Map([...this.loaded].filter(([name, loaded]) => roots.get(name) === loaded.root));
      this.troubles = new Map([...this.troubles].filter(([name]) => roots.has(name)));
      this.list = list;
      this.listTrouble = undefined;
    } catch (error: unknown) {
      if (!(error instanceof TallyError) || this.listStamp === undefined) throw error;
      this.listTrouble = messageOf(error);
    }
    this.listStamp = stamp;
    return this.list;
  }

  private async open(entry: RepoEntry): Promise<Repo> {
    const stamp = await stampOf(join(entry.root, RECORDS_DIR, CONFIG_FILE));
    const cached = this.loaded.get(entry.name);
    if (cached !== undefined && cached.stamp === stamp) return cached.repo;
    try {
      const repo = await openRepo(entry.root, { name: entry.name, stateDir: stateDirOf(this.home, entry.name) });
      this.loaded = new Map([...this.loaded, [entry.name, { root: entry.root, stamp, repo }]]);
      this.troubles = new Map([...this.troubles].filter(([name]) => name !== entry.name));
      return repo;
    } catch (error: unknown) {
      const gone = await isGone(entry.root);
      const problem = gone ? `${entry.root}, listed as ${entry.name}, is gone; put it back, or remove ${entry.name} from the list` : messageOf(error);
      if (cached === undefined || gone) {
        this.loaded = new Map([...this.loaded].filter(([name]) => name !== entry.name));
        this.trouble(entry.name, problem);
        throw new TallyError(problem);
      }
      this.loaded = new Map([...this.loaded, [entry.name, { root: cached.root, stamp, repo: cached.repo, problem }]]);
      return cached.repo;
    }
  }

  private trouble(name: string, problem: string): void {
    this.troubles = new Map([...this.troubles, [name, problem]]);
  }
}
