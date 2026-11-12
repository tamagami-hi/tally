import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { endSession, listSessions, openSession, writeRunner } from "@tally/core";
import { attempt, ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";

export function registerSessionTools(server: McpServer, source: RepoSource): void {
  server.registerTool(
    "session_open",
    {
      description: "Bind this agent session to one worktree and its track. Give the folder you work in: the repository and the track are found from it. A track's worktree must be on that track's branch; the repository's own checkout on its main branch gives operator scope. Returns the session id every writing tool needs, the repository's name, and `runner`: a script in the worktree that runs a command in your own shell and records it, as `<runner> <kind> [--task MILESTONE:TASK] -- <command...>`.",
      inputSchema: { worktree: z.string().describe("absolute path of the folder you work in"), track: z.string().optional().describe("the track's name; found from the worktree when left out, and checked against it when given"), agent: z.string().describe("who is working: a model or person name") },
    },
    ({ worktree, track, agent }) => attempt(async () => {
      const opened = await source.forWorktree(worktree);
      const session = await openSession(opened.repo, { worktree: opened.worktree, agent, ...(track === undefined ? {} : { track }) });
      const runner = await writeRunner(opened.repo, session.worktree, session.track);
      return ok({ ...session, repo: opened.repo.name, runner });
    }),
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
