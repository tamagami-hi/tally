import { readFile, realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { z } from "zod";
import { TallyError, advance, cancelTicket, joinQueue, landingTarget, ticketStates, ticketView, waitForTicket } from "@tally/core";
import { ok } from "../respond.ts";
import { inSession, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const MAX_WAIT_SECONDS = 30;

async function messageOfLanding(worktree: string, message: string | undefined, messageFile: string | undefined): Promise<string | undefined> {
  if (message !== undefined && messageFile !== undefined) throw new TallyError("give the message or a file that holds it, not both");
  if (messageFile === undefined) return message;
  const outside = new TallyError(`the message file must be inside the worktree: ${messageFile}`);
  const real = await realpath(resolve(worktree, messageFile)).catch(() => undefined);
  if (real === undefined) throw relative(worktree, resolve(worktree, messageFile)).startsWith("..") ? outside : new TallyError(`the message file does not exist: ${messageFile}`);
  if (relative(await realpath(worktree), real).startsWith("..")) throw outside;
  return readFile(real, "utf8");
}

export function registerLandTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "land_start",
    {
      description: "Join the landing queue with the session's track. It never blocks: the answer is a ticket with its state, its position and who is ahead. When the state is `turn`, tally has committed the named files, rebased the track onto main in a clean checkout and written a script: run the `run` command in your own shell (in the background if it is long), then call land_wait. With milestone and task, the landing records that task. Without files and a message it lands the commits the track already has.",
      inputSchema: { sessionId: z.string(), files: z.array(z.string()).default([]), message: z.string().optional().describe("the commit message"), messageFile: z.string().optional().describe("a file in the worktree that holds the commit message"), milestone: z.string().optional(), task: z.string().optional() },
    },
    ({ sessionId, files, message, messageFile, milestone, task }) => inSession(source, sessionId, async (repo, session) => {
      const target = landingTarget(milestone, task);
      const text = await messageOfLanding(session.worktree, message, messageFile);
      const ticket = await joinQueue(repo, session, { files, ...(text === undefined ? {} : { message: text }), ...(target === undefined ? {} : { target }) });
      await advance(repo);
      return ok(await ticketView(repo, ticket.id));
    }),
  );
  server.registerTool(
    "land_wait",
    {
      description: "Wait for a landing ticket to change, for up to 30 seconds: the call answers as soon as the ticket leaves the state given in `after`, or when the time is up. `turn` means run the `run` command now; `landed` and `failed` end the ticket, and a failure carries `problem` with the commit, the exit and the log. Call it again while the state is `queued`, or `turn` with the script still running.",
      inputSchema: { sessionId: z.string(), ticket: z.string(), after: z.enum(ticketStates).optional().describe("the state you last saw"), seconds: z.number().int().positive().max(MAX_WAIT_SECONDS).default(MAX_WAIT_SECONDS) },
    },
    ({ sessionId, ticket, after, seconds }) => inSession(source, sessionId, async (repo) => ok(await waitForTicket(repo, ticket, after, seconds))),
  );
  server.registerTool(
    "land_cancel",
    { description: "Take a ticket that has not had its turn out of the landing queue.", inputSchema: { sessionId: z.string(), ticket: z.string() } },
    ({ sessionId, ticket }) => inSession(source, sessionId, async (repo, session) => {
      await cancelTicket(repo, session, ticket);
      return ok(await ticketView(repo, ticket));
    }),
  );
}
