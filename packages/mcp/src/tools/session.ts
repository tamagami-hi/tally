import { access } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { TallyError, closedMessage, closedTrackAt, endSession, keepsContextAsRecords, listSessions, openScratch, openSession, sessionBrief, writeRunner } from "@tally/core";
import { attempt, ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

async function nearestFolder(path: string): Promise<string> {
  let folder = dirname(path);
  while (!(await isThere(folder)) && dirname(folder) !== folder) folder = dirname(folder);
  return folder;
}

const isThere = (path: string): Promise<boolean> => access(path).then(() => true, () => false);

async function explaining<T>(source: RepoSource, worktree: string, body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (error: unknown) {
    const closed = await explainedClosed(source, worktree);
    if (closed !== undefined) throw new TallyError(closed);
    throw error;
  }
}

async function explainedClosed(source: RepoSource, worktree: string): Promise<string | undefined> {
  try {
    const { repo } = await source.forWorktree(await nearestFolder(worktree));
    const track = await closedTrackAt(repo, worktree);
    return track === undefined ? undefined : closedMessage(track);
  } catch {
    return undefined;
  }
}

export function registerSessionTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "session_open",
    {
      description: "Bind this agent session to one worktree and its track. Give the folder you work in: the repository and the track are found from it. A track's worktree must be on that track's branch; the repository's own checkout on its main branch gives operator scope. Returns the session id every writing tool needs, the repository's name, and `runner`: a script in the worktree that runs a command in your own shell and records it, as `<runner> <kind> [--task MILESTONE:TASK] -- <command...>`, and `scratch`: a folder (made for you) for your plans, notes, logs and throwaway scripts, never /tmp or another hidden folder. In a repository whose config says `context: \"records\"` it also returns `brief`: the project, every rule (`rules`, in rulebook order: authority, safety, working, then doing each thing once; breaking a `safety` rule fails the work whatever the tests say; for an operator session `tailoring` lists the rules that still wait for this project's own answer), your track's tasks that are not landed and its hand-off, the id and title of each context entry that applies to your track's paths (read them with context_get), who else is working, how many questions are open, and `missing`, what the repository's context still lacks.",
      inputSchema: { worktree: z.string().describe("absolute path of the folder you work in"), track: z.string().optional().describe("the track's name; found from the worktree when left out, and checked against it when given"), agent: z.string().describe("who is working: a model or person name") },
    },
    ({ worktree, track, agent }) => attempt(() => explaining(source, worktree, async () => {
      const opened = await source.forWorktree(worktree);
      const session = await openSession(opened.repo, { worktree: opened.worktree, agent, ...(track === undefined ? {} : { track }) });
      const runner = await writeRunner(opened.repo, session.worktree, session.track);
      const brief = keepsContextAsRecords(opened.repo.config) ? { brief: await sessionBrief(opened.repo, session) } : {};
      const scratch = await openScratch(session.worktree, session.track);
      return ok({ ...session, repo: opened.repo.name, runner, scratch, ...brief });
    })),
  );
  server.registerTool(
    "session_close",
    { description: "Close a session: its claims and locks are released. In batch mode the last session to close commits every record waiting on disk as one commit; recordsCommit is null when there was nothing to commit or the landing lock stayed held, and then the records wait for `tally records commit`.", inputSchema: { sessionId: z.string() } },
    ({ sessionId }) => inSession(source, sessionId, async (repo) => ok(await endSession(repo, sessionId))),
  );
  server.registerTool(
    "session_list",
    { description: "Every open session of one repository: who is on which track since when.", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok({ sessions: await listSessions(repo) })),
  );
  server.registerTool(
    "repo_list",
    { description: "The repositories this server tracks: each one's name, its folder, its project name, how many sessions are open in it, and which is the default for a call that names none.", inputSchema: {} },
    () => attempt(async () => ok({ repos: await source.listed() })),
  );
}
