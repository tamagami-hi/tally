import { resolve } from "node:path";
import { z } from "zod";
import { Records, TallyError, evidenceKinds, landingLog, landingTarget, landTrack, loggedTests, recordLanding, runEvidence, runnerInstead, trackOf, type CommandPlace } from "@tally/core";
import { defined } from "../defined.ts";
import { ok } from "../respond.ts";
import { inSession, type RepoSource } from "../source.ts";
import type { ToolHost } from "../decorate.ts";

const ELSEWHERE = "this service does not run commands; land with land_start, which commits, rebases and hands you a script to run in your own shell, then land_wait";

const DESCRIPTIONS: Readonly<Record<CommandPlace, { landRun: string; evidenceRun: string }>> = {
  service: {
    landRun: "Land the session's track on main here: rebase, the configured tests (logged in the worktree), a commit as the operator from messageFile and explicit files, and a fast-forward. With commands.landing, the commit comes first and each commit ahead of main is tested in a clean checkout; a failure names the commit and the log and undoes this landing's commit, leaving its files staged. With milestone and task it records the task and releases its claim (`recording`); without them, use task_land. Refused at once while the operator checkout is off main or has uncommitted changes in a file this landing changes.",
    evidenceRun: "Run a command in the session's worktree with the landing environment, keep its log under .temp/<track>/tally/ and record it (cargo, vitest and pytest totals are read). A `red` that exited 0 or shows no failed test, or a `green` that did not exit 0, is kept as `other`, and `notice` says why. A task it cannot record for is refused before the run; after it, the answer says what ran, with `recorded: false` and `problem` when no record was written. A program not found here, or an exit of 126 or 127, is never recorded: the answer gives the runner line.",
  },
  agent: {
    landRun: "Land a track by running its tests in the service. This service runs no command (it runs in a container without the project's tools), so the call is refused: land with land_start, which commits, rebases and hands you a script to run in your own shell, then land_wait.",
    evidenceRun: "This service runs no command: it runs in a container without the project's tools. The call checks that the session may record for the task, then answers `ran: false`, `run`, the runner line for the command, and `why`. Run that line in your own shell: the runner keeps the log, records the run, and evidence_list shows the record a few seconds later. A `red` that exited 0 or shows no failed test, or a `green` that did not exit 0, is recorded as `other`; a run that exits 126 or 127 is not recorded.",
  },
};

const landInput = { sessionId: z.string(), files: z.array(z.string()).default([]), messageFile: z.string().optional(), verifiedCode: z.string().optional(), milestone: z.string().optional(), task: z.string().optional() };

const runInput = { sessionId: z.string(), milestone: z.string(), task: z.string(), kind: z.enum(evidenceKinds), command: z.array(z.string()).min(1), note: z.string().optional() };

function registerLandRun(server: ToolHost, source: RepoSource, place: CommandPlace): void {
  server.registerTool(
    "land_run",
    { description: DESCRIPTIONS[place].landRun, inputSchema: landInput },
    ({ sessionId, files, messageFile, verifiedCode, milestone, task }) => inSession(source, sessionId, async (repo, session) => {
      if (place === "agent") throw new TallyError(ELSEWHERE);
      trackOf(repo.config, session.track);
      const target = landingTarget(milestone, task);
      const log = landingLog(session.worktree, session.track);
      const lines: string[] = [];
      const landed = await landTrack(repo, { track: session.track, files, ...(messageFile === undefined ? {} : { messageFile: resolve(session.worktree, messageFile) }), ...(verifiedCode === undefined ? {} : { verifiedCode }) }, { runTests: loggedTests(log), log: (line) => lines.push(line) });
      const recording = target === undefined ? {} : { recording: await recordLanding(repo, landed, target, session) };
      return ok({ ...landed, log, lines, ...recording });
    }),
  );
}

export function registerCommandTools(server: ToolHost, source: RepoSource, place: CommandPlace): void {
  registerLandRun(server, source, place);
  server.registerTool(
    "evidence_run",
    { description: DESCRIPTIONS[place].evidenceRun, inputSchema: runInput },
    ({ sessionId, ...input }) => inSession(source, sessionId, async (repo, session) => {
      const ledger = await new Records(repo).readLedger();
      return ok(place === "agent" ? runnerInstead(repo, session, ledger, defined(input)) : await runEvidence(repo, session, ledger, defined(input)));
    }),
  );
}
