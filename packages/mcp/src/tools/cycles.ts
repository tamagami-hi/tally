import { z } from "zod";
import { closeCycle, cycleList, cycleOne } from "@tally/core";
import { LIMIT } from "../filters.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

export function registerCycleTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "cycle_list",
    {
      description: "The repository's cycles: the current one (its counts, `complete`, `blockers` and, once complete, `ask`) and the closed ones, newest first, 20 unless `limit` says, with `matched`. With `n`, that closed cycle whole: its record, totals and parked parts.",
      inputSchema: { n: z.number().int().positive().optional(), limit: LIMIT, ...WHERE },
    },
    ({ n, limit, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok(n === undefined ? await cycleList(repo, { limit }) : await cycleOne(repo, n))),
  );
  server.registerTool(
    "cycle_close",
    {
      description: "Close the current cycle (operator session, on the operator's word, quoted in `said`): its finished work moves to docs/records/cycles/cycle-<n>/, the tracks that can close are closed, and one records commit is made. Refused, changing nothing, while cycle_list names a blocker.",
      inputSchema: { sessionId: z.string(), summary: z.string(), said: z.string(), name: z.string().optional(), decision: z.string().optional() },
    },
    ({ sessionId, summary, said, name, decision }) => inSession(source, sessionId, async (repo, session) => ok(await closeCycle(repo, session, { summary, said, name, decision }))),
  );
}
