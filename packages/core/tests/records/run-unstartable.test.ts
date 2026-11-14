import { execFile } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RESULTS, RUNNER, writeRunner } from "../../src/land/runner.ts";
import { evidencePath, listEvidence, recordEvidence } from "../../src/records/evidence.ts";
import { listNotes } from "../../src/records/notes.ts";
import { takeResults } from "../../src/records/results.ts";
import { collectInbox } from "../../src/state/inbox.ts";
import { runEvidence, runnerInstead } from "../../src/records/run.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { busyLock } from "../support/busy.ts";
import { makeTracked } from "../support/tracked.ts";

async function ready() {
  const tracked = await makeTracked();
  const tree = tracked.trees["data"] ?? "";
  const session = await openSession(tracked.repo, { worktree: tree, track: "data", agent: "claude" });
  return { ...tracked, tree, session, ledger: await new Records(tracked.repo).readLedger() };
}

const evidenceText = (repo: Parameters<typeof evidencePath>[0]): Promise<string> => readFile(evidencePath(repo, "B2"), "utf8").catch(() => "none");

describe("where the agent runs the command", () => {
  test("evidence_run runs nothing and records nothing, and hands back the runner line", async () => {
    const { repo, tree, session, ledger } = await ready();
    const before = await evidenceText(repo);

    const answer = runnerInstead(repo, session, ledger, { milestone: "B2", task: "4 manifest", kind: "sweep", command: ["tools/run.sh", "npm test"] });

    expect(answer).toEqual({
      ran: false,
      run: `cd ${tree} && sh .temp/tally/run sweep --task 'B2:4 manifest' -- tools/run.sh 'npm test'`,
      why: "this service runs in a container without the project's tools, so it runs no command; run the line in your own shell: the runner records the run, and evidence_list shows the record a few seconds later",
    });
    expect(await evidenceText(repo)).toBe(before);
  });

  test("still refuses a task the session may not record for", async () => {
    const { repo, session, ledger } = await ready();

    expect(() => runnerInstead(repo, session, ledger, { milestone: "B2", task: "T9 store", kind: "green", command: ["true"] })).toThrow(/may not write track engine/);
  });
});

describe("a run the shell could not start", () => {
  test("is not recorded by evidence_run: the answer says what the exit means, the log's last line and the runner line", async () => {
    const { repo, tree, session, ledger } = await ready();
    const before = await evidenceText(repo);

    const result = await runEvidence(repo, session, ledger, { milestone: "B2", task: "4 manifest", kind: "sweep", command: ["sh", "-c", "echo starting; echo 'docker: not found'; exit 127"] });

    expect(result.recorded).toBe(false);
    expect(result.commit).toBeNull();
    expect(result.problem).toBe(`not recorded: exit 127 means the shell did not find a program; fix the command and run it again; the log ends: docker: not found; in your own shell: cd ${tree} && sh .temp/tally/run sweep --task 'B2:4 manifest' -- sh -c 'echo starting; echo '\\''docker: not found'\\''; exit 127'`);
    expect(await evidenceText(repo)).toBe(before);
  });

  test("is refused in plain words, with the runner line, when the program is not there at all", async () => {
    const { repo, tree, session, ledger } = await ready();

    await expect(runEvidence(repo, session, ledger, { milestone: "B2", task: "4 manifest", kind: "green", command: ["no-such-program", "x"] }))
      .rejects.toThrow(`no-such-program x could not start: no-such-program is not found where this service runs; run it in your own shell, and the runner records it: cd ${tree} && sh .temp/tally/run green --task 'B2:4 manifest' -- no-such-program x`);
  });

  test("is refused in plain words, with the runner line, when the program cannot be run here", async () => {
    const { repo, tree, session, ledger } = await ready();
    await writeFile(join(tree, "tool.sh"), "echo hi\n");
    await chmod(join(tree, "tool.sh"), 0o644);

    await expect(runEvidence(repo, session, ledger, { milestone: "B2", task: "4 manifest", kind: "green", command: [join(tree, "tool.sh")] }))
      .rejects.toThrow(`could not start: ${join(tree, "tool.sh")} cannot be run where this service runs; run it in your own shell, and the runner records it: cd ${tree} && sh .temp/tally/run green`);
  });

  test("asks for a milestone the runner can name, since it splits MILESTONE:TASK at the first colon", async () => {
    const { repo, session, ledger } = await ready();
    const odd = { ...ledger, milestones: ledger.milestones.map((one) => ({ ...one, id: "B:2" })) };

    expect(() => runnerInstead(repo, session, odd, { milestone: "B:2", task: "4 manifest", kind: "green", command: ["true"] })).toThrow("the runner cannot name milestone B:2, since it splits MILESTONE:TASK at the first ':'; record the run with evidence_record");
  });

  test("is refused by evidence_record, for 126 as for 127", async () => {
    const { repo, tree, session, ledger } = await ready();
    const run = { milestone: "B2", task: "4 manifest", kind: "green" as const, command: ["make"], cwd: tree, started: "2026-11-14T10:00:00Z", seconds: 1 };

    await expect(recordEvidence(repo, session, ledger, { ...run, exit: 127 })).rejects.toThrow("not recorded: exit 127 means the shell did not find a program; fix the command and run it again");
    await expect(recordEvidence(repo, session, ledger, { ...run, exit: 126 })).rejects.toThrow("not recorded: exit 126 means the shell found a program it could not run; fix the command and run it again");
    expect(await listEvidence(repo, "B2")).toEqual([]);
  });
});

describe("a runner result the service refuses", () => {
  test("is never evidence when an older runner left an exit of 127, and its track is told", async () => {
    const { repo, tree } = await ready();
    const folder = join(tree, RESULTS, "20261114T100000Z-1");
    await mkdir(folder, { recursive: true });
    const fields = { kind: "sweep", task: "B2:4 manifest", note: "", head: "", cwd: tree, started: "2026-11-14T10:00:00Z", seconds: "1", exit: "127", log: join(tree, "x.log"), argv: "docker\0ps\0" };
    for (const [name, value] of Object.entries(fields)) await writeFile(join(folder, name), `${value}\n`);
    await writeFile(join(tree, "x.log"), "sh: docker: not found\n");

    const [taken] = await takeResults(repo);

    expect(taken?.problem).toContain("not recorded: exit 127 means the shell did not find a program");
    expect(await listEvidence(repo, "B2")).toEqual([]);
    expect((await listNotes(repo, { track: "data", state: "all" })).map((note) => note.text)).toEqual([expect.stringContaining("(sweep: docker ps) was not recorded")]);
  });

  test("keeps where the result is kept in a note about a long command", async () => {
    const { repo, tree } = await ready();
    await writeRunner(repo, tree, "data");
    await new Promise<void>((done) => execFile("sh", [join(tree, RUNNER), "green", "--", "sh", "-c", `true ${"x".repeat(700)}`], { cwd: tree }, () => done()));

    const [taken] = await takeResults(repo);

    const [note] = await listNotes(repo, { track: "data", state: "all" });
    expect(note?.text.endsWith(`the result is kept in ${join(tree, RESULTS, "refused", taken?.id ?? "")}`)).toBe(true);
  });

  test("is still set aside when its note cannot be written, and the inbox says so instead", async () => {
    const { repo, tree, session } = await ready();
    await writeRunner(repo, tree, "data");
    await collectInbox(repo, session);
    busyLock("notes.json");
    await new Promise<void>((done) => execFile("sh", [join(tree, RUNNER), "green", "--", "true"], { cwd: tree }, () => done()));

    const [taken] = await takeResults(repo);
    const items = await collectInbox(repo, session, new Date(Date.now() + 2000));

    expect(taken?.problem).toMatch(/the run names no task.*; the track was not told: /);
    expect(items).toContainEqual(expect.objectContaining({ kind: "run", text: expect.stringContaining("a green run was set aside: the run names no task") }));
  });

  test("leaves one note for its track, saying which run, why and where the result is kept", async () => {
    const { repo, tree } = await ready();
    await writeRunner(repo, tree, "data");
    await new Promise<void>((done) => execFile("sh", [join(tree, RUNNER), "green", "--", "true"], { cwd: tree }, () => done()));

    const [taken] = await takeResults(repo);
    await takeResults(repo);

    const notes = await listNotes(repo, { track: "data", state: "all" });
    expect(notes).toHaveLength(1);
    expect(notes[0]?.from).toEqual({ track: "main", agent: "tally" });
    expect(notes[0]?.text).toBe(`the run ${taken?.id} (green: true) was not recorded: the run names no task, and no session in this worktree holds one; pass --task MILESTONE:TASK; the result is kept in ${join(tree, RESULTS, "refused", taken?.id ?? "")}`);
  });
});
