import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  Records, TallyError, acquireLock, evidenceKinds, getSession, landTrack, listEvidence, listLocks, readHandoff, recordEvidence, releaseLock,
  runEvidence, safeName, trackOf, writeHandoff, type Repo, type Session,
} from "@tally/core";
import { attempt, ok } from "../respond.ts";

const summaryValue = z.union([z.number(), z.string(), z.boolean()]);

function defined<T extends Record<string, unknown>>(input: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as { [K in keyof T]: Exclude<T[K], undefined> };
}

function captured(session: Session): { log: string; run: (cwd: string, command: readonly string[], env: NodeJS.ProcessEnv) => Promise<void> } {
  const folder = join(session.worktree, ".temp", safeName(session.track), "tally", "landings");
  const log = join(folder, `${new Date().toISOString().replaceAll(/[:.]/g, "-")}.log`);
  const run = async (cwd: string, command: readonly string[], env: NodeJS.ProcessEnv): Promise<void> => {
    await mkdir(folder, { recursive: true });
    const [program, ...args] = command;
    if (program === undefined) throw new TallyError("the config names no test command");
    await new Promise<void>((done, fail) => {
      const file = createWriteStream(log);
      const child = execFile(program, args, { cwd, env, maxBuffer: 256 * 1024 * 1024 }, (error) => {
        file.end();
        if (error === null) done();
        else fail(new TallyError(`${command.join(" ")} failed in ${cwd}; the log is ${log}`));
      });
      child.stdout?.pipe(file, { end: false });
      child.stderr?.pipe(file, { end: false });
    });
  };
  return { log, run };
}

export function registerRecordTools(server: McpServer, repo: Repo): void {
  const records = new Records(repo);

  server.registerTool(
    "land_run",
    { description: "Land the session's track on main: rebase, the configured tests (their output to a log in the worktree), a commit as the operator from --message and explicit files, a fast-forward of main. Then record it with task_land.", inputSchema: { sessionId: z.string(), files: z.array(z.string()).default([]), messageFile: z.string().optional(), verifiedCode: z.string().optional() } },
    ({ sessionId, files, messageFile, verifiedCode }) => attempt(async () => {
      const session = await getSession(repo, sessionId);
      trackOf(repo.config, session.track);
      const { log, run } = captured(session);
      const lines: string[] = [];
      const landed = await landTrack(repo, { track: session.track, files, ...(messageFile === undefined ? {} : { messageFile: resolve(session.worktree, messageFile) }), ...(verifiedCode === undefined ? {} : { verifiedCode }) }, { runTests: run, log: (line) => lines.push(line) });
      return ok({ ...landed, log, lines });
    }),
  );
  server.registerTool(
    "evidence_record",
    { description: "Record a run that already happened: its command, cwd, timing, exit, an optional log (inside the worktree, hashed) and summary.", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), kind: z.enum(evidenceKinds), command: z.array(z.string()).min(1), cwd: z.string(), started: z.string(), seconds: z.number().nonnegative(), exit: z.number().int(), logPath: z.string().optional(), summary: z.record(z.string(), summaryValue).optional(), note: z.string().optional() } },
    ({ sessionId, ...input }) => attempt(async () => ok(await recordEvidence(repo, await getSession(repo, sessionId), await records.readLedger(), defined(input)))),
  );
  server.registerTool(
    "evidence_run",
    { description: "Run a command in the session's worktree with the landing environment, keep its log under .temp/<track>/tally/, and record it (cargo and vitest totals are read from the output).", inputSchema: { sessionId: z.string(), milestone: z.string(), task: z.string(), kind: z.enum(evidenceKinds), command: z.array(z.string()).min(1), note: z.string().optional() } },
    ({ sessionId, ...input }) => attempt(async () => ok(await runEvidence(repo, await getSession(repo, sessionId), await records.readLedger(), defined(input)))),
  );
  server.registerTool(
    "evidence_list",
    { description: "The run records of a milestone, or of one task in it.", inputSchema: { milestone: z.string(), task: z.string().optional() } },
    ({ milestone, task }) => attempt(async () => ok({ records: await listEvidence(repo, milestone, task) })),
  );
  server.registerTool(
    "handoff_write",
    { description: "Leave the track's hand-off note (at most 60 lines): what the next session cannot find in the commits.", inputSchema: { sessionId: z.string(), task: z.string().optional(), lines: z.array(z.string()).min(1) } },
    ({ sessionId, task, lines }) => attempt(async () => ok(await writeHandoff(repo, await getSession(repo, sessionId), { ...(task === undefined ? {} : { task }), lines }))),
  );
  server.registerTool(
    "handoff_read",
    { description: "A track's current hand-off note and its history.", inputSchema: { track: z.string() } },
    ({ track }) => attempt(async () => ok(await readHandoff(repo, track))),
  );
  server.registerTool(
    "lock_acquire",
    { description: "Hold one of the config's named locks (for example the evidence host) with a note; it dies with the session.", inputSchema: { sessionId: z.string(), name: z.string(), note: z.string() } },
    ({ sessionId, name, note }) => attempt(async () => ok(await acquireLock(repo, await getSession(repo, sessionId), name, note))),
  );
  server.registerTool(
    "lock_release",
    { description: "Release a lock this session holds.", inputSchema: { sessionId: z.string(), name: z.string() } },
    ({ sessionId, name }) => attempt(async () => ok(await releaseLock(repo, await getSession(repo, sessionId), name))),
  );
  server.registerTool(
    "lock_list",
    { description: "Every held lock: name, holder, note, since.", inputSchema: {} },
    () => attempt(async () => ok({ locks: await listLocks(repo) })),
  );
}
