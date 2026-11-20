import { z } from "zod";
import {
  Records, acquireLock, KINDS_AND_WORDS, isOfKind, storedKind, findMilestone, latestHistory, listEvidence, listLocks, listManual, manualResults, readHandoff, recordEvidence, recordManual, releaseLock, writeHandoff, type ManualCheck,
} from "@tally/core";
import { FIELDS, LIMIT, lastStarted, pick, startedSince } from "../filters.ts";
import { defined } from "../defined.ts";
import { ok } from "../respond.ts";
import { CYCLE, WHERE, inSession, reading, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const summaryValue = z.union([z.number(), z.string(), z.boolean()]);

const DEFAULT_RECORDS = 20;

const MANUAL = "manual";

const EVIDENCE_MANUAL = "A check a person made that no command can show, in 1 to 30 steps. Each attachment is a file under the repository's .temp/, at most 200 MB, kept in place by path, hash and size.";

const manualInput = { sessionId: z.string(), milestone: z.string(), task: z.string(), who: z.string().min(1), result: z.enum(manualResults), steps: z.array(z.string()), device: z.string().optional(), build: z.string().optional(), note: z.string().optional(), attachments: z.array(z.string()).optional() };

const atSince = (checks: ManualCheck[], since: string | undefined): ManualCheck[] => (since === undefined ? checks : checks.filter((check) => check.at >= since));

const manualCount = (checks: readonly ManualCheck[]): { manual?: number } => (checks.length === 0 ? {} : { manual: checks.length });

export function registerRecordTools(server: ToolHost, source: RepoSource): void {
  server.registerTool(
    "evidence_record",
    { description: "Record a run that already happened: its command, cwd, timing, exit, an optional log (in the worktree, hashed) and summary (else the log's totals are read). A `red` that exited 0 or shows no failed test, or a `green` that did not exit 0, is kept as `other`, and `notice` says why. An exit of 126 or 127 is refused.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), kind: z.enum(KINDS_AND_WORDS), command: z.array(z.string()).min(1), cwd: z.string(), started: z.string(), seconds: z.number().nonnegative(), exit: z.number().int(), logPath: z.string().optional(), summary: z.record(z.string(), summaryValue).optional(), note: z.string().optional(), scope: z.string().optional() } },
    ({ sessionId, kind, ...input }) => inSession(source, sessionId, async (repo, session) => ok(await recordEvidence(repo, session, await new Records(repo).readLedger(), { ...defined(input), ...storedKind(kind) }))),
  );
  server.registerTool(
    "evidence_list",
    { description: "The run records of a milestone, or of one of its tasks: the 20 started last unless `limit` says, with `matched`. `kind` and `since` (an ISO time: runs started at or after it) narrow them; `fields` keeps only those keys of each record.", inputSchema: { milestone: z.string(), task: z.string().optional(), kind: z.enum([...KINDS_AND_WORDS, MANUAL]).optional(), since: z.string().optional().describe("an ISO time, such as 2026-11-04T09:00:00Z"), limit: LIMIT, fields: FIELDS, cycle: CYCLE, ...WHERE } },
    ({ milestone, task, kind, since, limit, fields, cycle, sessionId, repo: name }) => reading(source, { sessionId, repo: name, cycle }, async (repo) => {
      const kept = await listEvidence(repo, milestone, task);
      const checks = await listManual(repo, milestone, task);
      if (kept.length === 0 && checks.length === 0) findMilestone(await new Records(repo).readLedger(), milestone);
      if (kind === MANUAL) {
        const made = atSince(checks, since);
        return ok({ checks: made.slice(-(limit ?? DEFAULT_RECORDS)).map((check) => pick(check, fields)), matched: made.length });
      }
      const ofKind = kept.filter((record) => kind === undefined || isOfKind(record, kind));
      const found = startedSince(ofKind, since);
      return ok({ records: lastStarted(found, limit ?? DEFAULT_RECORDS).map((record) => pick(record, fields)), matched: found.length, ...manualCount(checks) });
    }),
  );
  server.registerTool(
    "evidence_manual",
    { description: EVIDENCE_MANUAL, inputSchema: manualInput },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo, session) => ok(await recordManual(repo, session, defined(input)))),
  );
  server.registerTool(
    "handoff_write",
    { description: "Leave the track's hand-off note (at most 60 lines): what the next session cannot find in the commits.", inputSchema: { sessionId: z.string(), task: z.string().optional(), lines: z.array(z.string()).min(1) } },
    ({ sessionId, task, lines }) => inSession(source, sessionId, async (repo, session) => ok(await writeHandoff(repo, session, { ...(task === undefined ? {} : { task }), lines }))),
  );
  server.registerTool(
    "handoff_read",
    { description: "A track's current hand-off note and its earlier ones, oldest first. A session wants `history: 0`, the current note alone (`earlier` counts the rest), unless it reads how the hand-off changed.", inputSchema: { track: z.string(), history: z.number().int().nonnegative().optional().describe("how many of the latest earlier notes to answer; all when left out"), cycle: CYCLE, ...WHERE } },
    ({ track, history, cycle, sessionId, repo: name }) => reading(source, { sessionId, repo: name, cycle }, async (repo) => {
      const handoff = await readHandoff(repo, track);
      return ok(history === undefined ? handoff : latestHistory(handoff, history));
    }),
  );
  server.registerTool(
    "lock_acquire",
    { description: "Hold one of the config's named locks (for example the evidence host) with a note; it dies with the session.", inputSchema: { sessionId: z.string(), name: z.string(), note: z.string() } },
    ({ sessionId, name, note }) => inSession(source, sessionId, async (repo, session) => ok(await acquireLock(repo, session, name, note))),
  );
  server.registerTool(
    "lock_release",
    { description: "Release a lock this session holds.", inputSchema: { sessionId: z.string(), name: z.string() } },
    ({ sessionId, name }) => inSession(source, sessionId, async (repo, session) => ok(await releaseLock(repo, session, name))),
  );
  server.registerTool(
    "lock_list",
    { description: "Every held lock: name, holder, note, since.", inputSchema: { ...WHERE } },
    ({ sessionId, repo: name }) => reading(source, { sessionId, repo: name }, async (repo) => ok({ locks: await listLocks(repo) })),
  );
}
