import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { closeSession, flushWhenFree, listSessions, openSession, releaseClaimsOf, releaseLocksOf, type Repo } from "@tally/core";
import { attempt, ok } from "../respond.ts";

export function registerSessionTools(server: McpServer, repo: Repo): void {
  server.registerTool(
    "session_open",
    {
      description: "Bind this agent session to one worktree and one track. The worktree must be that track's worktree, on its branch; the repository's own checkout on its main branch gives operator scope. Returns the session id every writing tool needs.",
      inputSchema: { worktree: z.string().describe("absolute path of the worktree"), track: z.string().describe("the track name from config.json, or the main branch for the operator"), agent: z.string().describe("who is working: a model or person name") },
    },
    ({ worktree, track, agent }) => attempt(async () => ok(await openSession(repo, { worktree, track, agent }))),
  );
  server.registerTool(
    "session_close",
    { description: "Close a session: its claims and locks are released. In batch mode the last session to close commits every record waiting on disk as one commit; recordsCommit is null when there was nothing to commit or the landing lock stayed held, and then the records wait for `tally records commit`.", inputSchema: { sessionId: z.string() } },
    ({ sessionId }) => attempt(async () => {
      const claims = await releaseClaimsOf(repo, sessionId);
      const locks = await releaseLocksOf(repo, sessionId);
      const session = await closeSession(repo, sessionId);
      const recordsCommit = repo.config.records.batch === true && (await listSessions(repo)).length === 0 ? await flushWhenFree(repo) : null;
      return ok({ session, releasedClaims: claims, releasedLocks: locks, recordsCommit });
    }),
  );
  server.registerTool(
    "session_list",
    { description: "Every open session: who is on which track since when.", inputSchema: {} },
    () => attempt(async () => ok({ sessions: await listSessions(repo) })),
  );
}
