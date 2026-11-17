import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RUNNER, writeRunner } from "../../src/land/runner.ts";
import { judgeRun, listEvidence, recordEvidence } from "../../src/records/evidence.ts";
import { importEvidence } from "../../src/records/import-evidence.ts";
import { takeResults } from "../../src/records/results.ts";
import { runEvidence } from "../../src/records/run.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { makeTracked } from "../support/tracked.ts";

const FAILED_GREEN = "recorded as other, not green: it exited 1";

function runner(tree: string, args: readonly string[]): Promise<void> {
  return new Promise((done) => {
    execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, () => done());
  });
}

async function dataSession() {
  const tracked = await makeTracked();
  const tree = tracked.trees["data"] ?? "";
  const session = await openSession(tracked.repo, { worktree: tree, track: "data", agent: "a" });
  return { ...tracked, tree, session, ledger: await new Records(tracked.repo).readLedger() };
}

describe("a green that did not exit 0", () => {
  test("recorded by hand is filed as other, and the answer and the note say why", async () => {
    const { repo, session, ledger } = await dataSession();
    const run = { milestone: "B2", task: "4 manifest", command: ["x"], cwd: ".", started: "", seconds: 0 };

    const failed = await recordEvidence(repo, session, ledger, { ...run, kind: "green", exit: 1, note: "after the fix" });

    expect(failed.record.kind).toBe("other");
    expect(failed.notice).toBe(FAILED_GREEN);
    expect(failed.record.note).toBe(`${FAILED_GREEN}; after the fix`);
  });

  test("run by the service is filed as other", async () => {
    const { repo, session, ledger } = await dataSession();

    const ran = await runEvidence(repo, session, ledger, { milestone: "B2", task: "4 manifest", kind: "green", command: ["sh", "-c", "exit 1"] });

    expect(ran.record.kind).toBe("other");
    expect(ran.notice).toBe(FAILED_GREEN);
    expect((await listEvidence(repo, "B2", "4 manifest")).map((record) => record.kind)).toEqual(["other"]);
  });

  test("run through the runner is filed as other when its result is taken in", async () => {
    const { repo, tree } = await dataSession();
    await writeRunner(repo, tree, "data");
    await runner(tree, ["green", "--task", "B2:4 manifest", "--", "sh", "-c", "exit 1"]);

    const [taken] = await takeResults(repo);

    expect(taken?.notice).toBe(FAILED_GREEN);
    expect((await listEvidence(repo, "B2", "4 manifest")).map((record) => record.kind)).toEqual(["other"]);
  });

  test("indexed from a folder is filed as other, keeping where it came from", async () => {
    const { repo, tree } = await dataSession();
    const dir = join(tree, ".temp", "data", "B2", "false-green");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "green.json"), JSON.stringify({ command: ["cargo", "test"], cwd: tree, started: 1793712038, seconds: 1, exit: 1 }));

    await importEvidence(repo, dir, { milestone: "B2", task: "4 manifest" });

    const [record] = await listEvidence(repo, "B2", "4 manifest");
    expect(record?.kind).toBe("other");
    expect(record?.note).toBe(`${FAILED_GREEN}; indexed from .temp/worktrees/data/.temp/data/B2/false-green/green.json`);
  });

  test("names the exit it had", () => {
    expect(judgeRun({ kind: "green", exit: 101 })).toEqual({ kind: "other", note: "recorded as other, not green: it exited 101", notice: "recorded as other, not green: it exited 101" });
  });
});

describe("the runs the judge leaves alone", () => {
  test("a green that exited 0 stays green with no notice", async () => {
    const { repo, session, ledger } = await dataSession();

    const passed = await recordEvidence(repo, session, ledger, { milestone: "B2", task: "4 manifest", kind: "green", command: ["x"], cwd: ".", started: "", seconds: 0, exit: 0 });

    expect(passed.record.kind).toBe("green");
    expect(passed.notice).toBeUndefined();
    expect(passed.record.note).toBeUndefined();
  });

  test("a red is judged as before, and another kind is not judged", () => {
    expect(judgeRun({ kind: "red", exit: 0 }).notice).toBe("recorded as other, not red: it exited 0");
    expect(judgeRun({ kind: "red", exit: 1, summary: { failed: 2 } })).toEqual({ kind: "red" });
    expect(judgeRun({ kind: "clippy", exit: 101 })).toEqual({ kind: "clippy" });
    expect(judgeRun({ kind: "sweep", exit: 1, note: "kept" })).toEqual({ kind: "sweep", note: "kept" });
  });
});
