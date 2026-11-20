import { z } from "zod";
import { Records, TallyError, commitRecords, countParts, deferredRows, deferredStates, matchingRows, setDeferred } from "@tally/core";
import { parkedInput } from "../deferred-input.ts";
import { FIELDS, pick } from "../filters.ts";
import { ok } from "../respond.ts";
import { WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const DEFAULT_PARTS = 50;
const MOST_PARTS = 200;
const ROW_KEYS: readonly string[] = ["milestone", "task", "track", "part", "what", "state", "to", "parked"];

export function registerDeferredTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "deferred_list",
    {
      description: "The parts landed tasks left undone, in ledger order, 50 unless `limit` says: each with its `part` number (from 1), `state` (unplaced, waiting for its task, done, or parked) and its `to` or `parked`. Filters narrow it; `counts` covers the whole ledger, `matched` the filter. A gap is an unplaced part, or one left to a task not in the ledger: place it with deferred_set.",
      inputSchema: { state: z.enum(deferredStates).optional(), milestone: z.string().optional(), track: z.string().optional(), decision: z.string().optional(), owner: z.string().optional(), limit: z.number().int().positive().max(MOST_PARTS).optional(), fields: FIELDS, ...WHERE },
    },
    ({ state, milestone, track, decision, owner, limit, fields, sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => {
      const rows = deferredRows(await new Records(repo).readLedger());
      const unknown = (fields ?? []).filter((key) => !ROW_KEYS.includes(key));
      if (unknown.length > 0) throw new TallyError(`a part has no '${unknown.join("', '")}'; its keys: ${ROW_KEYS.join(", ")}`);
      const found = matchingRows(rows, { state, milestone, track, decision, owner });
      return ok({ parts: found.slice(0, limit ?? DEFAULT_PARTS).map((row) => pick({ ...row }, fields)), matched: found.length, counts: countParts(rows) });
    }),
  );
  server.registerTool(
    "deferred_set",
    {
      description: "Place one deferred part: leave it to a task (`to`) or park it (`parked`), not both. A session that may write the task places it; parking is an operator session's, or names the decision covering it. A parked part is no gap and leaves its task whole. Answers the part as it was and as it is.",
      inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), part: z.number().int().positive(), to: z.string().min(1).optional(), parked: parkedInput.optional() },
    },
    ({ sessionId, milestone, task, part, to, parked }) => inSession(source, sessionId, async (repo, session) => {
      const placed = await setDeferred(repo, session, { milestone, task, part, to, parked });
      return ok({ ...placed, commit: await commitRecords(repo, placed.message) });
    }),
  );
}
