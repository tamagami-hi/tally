import { access } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { TallyError, briefLevels, messageOf, closedMessage, closedTrackAt, endSession, keepsContextAsRecords, listSessions, openScratch, openSession, sessionBrief, writeRunner } from "@tally/core";
import type { BriefLevel, CommandPlace, Repo, Session } from "@tally/core";
import { attempt, ok } from "../respond.ts";
import { WHERE, finished, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";
import { serverInfo } from "../server-info.ts";
import { rolesOf, type Role } from "../roles.ts";

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

async function settled(repo: Repo, session: Session): Promise<{ runner: string; scratch: string }> {
  try {
    return { runner: await writeRunner(repo, session.worktree, session.track), scratch: await openScratch(session.worktree, session.track) };
  } catch (error: unknown) {
    await endSession(repo, session.id);
    throw error;
  }
}

async function briefOf(repo: Repo, session: Session, level: BriefLevel): Promise<{ brief: Awaited<ReturnType<typeof sessionBrief>> } | { briefProblem: string }> {
  try {
    return { brief: await sessionBrief(repo, session, level) };
  } catch (error: unknown) {
    return { briefProblem: `the session is open, but its brief could not be made: ${messageOf(error)}` };
  }
}

export function registerSessionTools(server: ToolHost, source: RepoSource, place: CommandPlace = "service", role?: Role): void {
  server.registerTool(
    "session_open",
    {
      description: "Bind this session to the folder you work in; it finds the repository and track (a track's worktree must be on its branch; the repository's checkout on main is operator scope). Answers the id writing tools need, the repository's name, `runner` (`<runner> <kind> [--task MILESTONE:TASK] -- <command...>` runs and records a command in your shell) and `scratch`, for notes and throwaway files (never /tmp or another hidden folder). With `context: \"records\"` in the config, `brief` comes at the level asked: `full` (default) has the project, every rule's text (breaking a `safety` rule fails the work), your open tasks and hand-off, the entries that apply, who else works, open questions and what the context lacks; `work` gives rules by title, the project by its purpose, no lacks; `land` your tasks by id, who works and `rulebook`. Go below full only when this conversation holds the full brief; read rulebook_get when `rulebook.changedAt` is later than yours. `server`: the version and newest tools; one missing from your list means reconnect.",
      inputSchema: { worktree: z.string().describe("absolute path of the folder you work in"), track: z.string().optional().describe("the track's name; found from the worktree when left out, and checked against it when given"), agent: z.string().describe("who is working: a model or person name"), brief: z.enum(briefLevels).default(role === undefined ? "full" : "order").describe("how much brief; order is a track's work order") },
    },
    ({ worktree, track, agent, brief: level }) => attempt(() => explaining(source, worktree, async () => {
      const opened = await source.forWorktree(worktree);
      await finished(opened.repo);
      const session = await openSession(opened.repo, { worktree: opened.worktree, agent, ...(track === undefined ? {} : { track }) });
      const ready = await settled(opened.repo, session);
      const brief = keepsContextAsRecords(opened.repo.config) ? await briefOf(opened.repo, session, level) : {};
      return ok({ ...session, repo: opened.repo.name, ...ready, ...brief, server: serverInfo(place) });
    })),
  );
  server.registerTool(
    "session_close",
    { description: "Close a session: its claims and locks are released. In batch mode the last session to close commits every record waiting on disk as one commit (`recordsCommit`, else null). `records` says in a sentence what happened to the records under this repository's records mode.", inputSchema: { sessionId: z.string() } },
    ({ sessionId }) => inSession(source, sessionId, async (repo) => ok(await endSession(repo, sessionId))),
  );
  server.registerTool(
    "session_list",
    { description: "Every open session of one repository: who is on which track since when.", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok({ sessions: await listSessions(repo) })),
  );
  server.registerTool(
    "repo_list",
    { description: "The repositories this server tracks: each one's name, its folder, its project name, how many sessions are open in it, and which is the default for a call that names none. `server` names the version and its newest tools: if one is missing from your list, reconnect.", inputSchema: {} },
    () => attempt(async () => ok({ repos: await source.listed(), server: serverInfo(place), roles: rolesOf(source.prefix) })),
  );
}
