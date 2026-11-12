import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LiveRepo, TallyError, getSession, gitOut, listSessions, realFolder, stateDirOf, type Repo, type Repos, type Session } from "@tally/core";
import { attempt } from "./respond.ts";

export interface Opened {
  repo: Repo;
  worktree: string;
}

export interface Where {
  sessionId?: string | undefined;
  repo?: string | undefined;
}

export interface ListedRepo {
  name: string;
  root: string;
  project: string;
  sessions: number;
  isDefault: boolean;
  problem?: string;
}

export interface RepoSource {
  readonly instructions: string;
  forSession(sessionId: string): Promise<Repo>;
  forWorktree(path: string): Promise<Opened>;
  forRead(where: Where): Promise<Repo>;
  listed(): Promise<ListedRepo[]>;
}

export const WHERE = {
  sessionId: z.string().optional().describe("your session: the tool reads that session's repository"),
  repo: z.string().optional().describe("a repository's name from repo_list; with neither this nor a session, the default repository"),
};

export const isSource = (from: Repo | RepoSource): from is RepoSource => "forSession" in from;

export function oneRepo(first: Repo): RepoSource {
  const live = new LiveRepo(first);
  return {
    instructions: `tally tracks the build of ${first.config.name}. Open a session with session_open (your worktree and track) before any writing tool; read context_pack at your level first. Records change only through these tools; main is never pushed from here.`,
    forSession: () => live.current(),
    forWorktree: async (path) => ({ repo: await live.current(), worktree: path }),
    forRead: ({ repo: name }) => (name === undefined || name === first.name ? live.current() : Promise.reject(new TallyError(`this server serves only ${first.name}, not ${name}`))),
    listed: async () => {
      const repo = await live.current();
      const problem = live.problem;
      return [{ name: repo.name, root: repo.root, project: repo.config.name, sessions: (await listSessions(repo)).length, isDefault: true, ...(problem === undefined ? {} : { problem }) }];
    },
  };
}

async function sessionsOf(repos: Repos, name: string): Promise<number> {
  try {
    return (await listSessions({ stateDir: stateDirOf(repos.home, name) })).length;
  } catch {
    return 0;
  }
}

async function projectOf(repos: Repos, name: string): Promise<string> {
  try {
    return (await repos.get(name)).config.name;
  } catch {
    return "";
  }
}

export function manyRepos(repos: Repos): RepoSource {
  return {
    instructions: "tally tracks the builds of the repositories in its list; repo_list names them. Begin with session_open: give it the folder you work in, and it finds the repository and your track. Each repository is separate: a session reads and writes only its own. Read context_pack at your level before you write. Records change only through these tools; main is never pushed from here.",
    forSession: async (sessionId) => (await repos.ofSession(sessionId)).repo,
    forWorktree: async (path) => {
      const folder = await realFolder(path);
      const repo = await repos.forPath(folder);
      return { repo, worktree: (await gitOut(folder, ["rev-parse", "--show-toplevel"])) ?? folder };
    },
    forRead: async ({ sessionId, repo: name }) => {
      if (sessionId === undefined) return name === undefined ? repos.default() : repos.get(name);
      const { repo } = await repos.ofSession(sessionId);
      if (name !== undefined && name !== repo.name) throw new TallyError(`session ${sessionId} is in ${repo.name}, not ${name}`);
      return repo;
    },
    listed: async () => {
      const chosen = await repos.defaultName();
      const rows: ListedRepo[] = [];
      for (const entry of await repos.entries()) {
        const project = await projectOf(repos, entry.name);
        const problem = repos.problem(entry.name);
        rows.push({ name: entry.name, root: entry.root, project, sessions: await sessionsOf(repos, entry.name), isDefault: entry.name === chosen, ...(problem === undefined ? {} : { problem }) });
      }
      return rows;
    },
  };
}

export function inSession(source: RepoSource, sessionId: string, body: (repo: Repo, session: Session) => Promise<CallToolResult>): Promise<CallToolResult> {
  return attempt(async () => {
    const repo = await source.forSession(sessionId);
    return body(repo, await getSession(repo, sessionId));
  });
}

export function reading(source: RepoSource, where: Where, body: (repo: Repo) => Promise<CallToolResult>): Promise<CallToolResult> {
  return attempt(async () => body(await source.forRead(where)));
}
