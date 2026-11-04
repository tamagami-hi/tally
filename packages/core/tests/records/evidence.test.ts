import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { listEvidence, recordEvidence } from "../../src/records/evidence.ts";
import { readHandoff, writeHandoff } from "../../src/records/handoffs.ts";
import { runEvidence, summarize } from "../../src/records/run.ts";
import { Records } from "../../src/store/records.ts";
import { openSession } from "../../src/state/sessions.ts";
import { busyLock } from "../support/busy.ts";
import { makeTracked } from "../support/tracked.ts";

describe("evidence records", () => {
  test("record a run with its hashed log, scoped to the session's track, and list by task", async () => {
    const { repo, trees } = await makeTracked();
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    await writeFile(join(trees["data"]!, "red.log"), "test result: FAILED. 0 passed; 3 failed; 0 ignored\n");
    const { record } = await recordEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "red", command: ["cargo", "test"], cwd: trees["data"]!, started: "2026-11-04T00:00:00Z", seconds: 3.2, exit: 101, logPath: "red.log", summary: { passed: 0, failed: 3 } });
    expect(record.log).toMatchObject({ bytes: 51, sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await listEvidence(repo, "B2", "4 manifest")).map((r) => r.kind)).toEqual(["red"]);
    expect(await listEvidence(repo, "B2", "T9 store")).toEqual([]);
    await expect(recordEvidence(repo, data, ledger, { milestone: "B2", task: "T9 store", kind: "green", command: ["x"], cwd: ".", started: "", seconds: 0, exit: 0 })).rejects.toThrow(/may not write track engine/);
    await expect(recordEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "green", command: ["x"], cwd: ".", started: "", seconds: 0, exit: 0, logPath: "../outside.log" })).rejects.toThrow(/inside the session's worktree/);
    await expect(recordEvidence(repo, data, ledger, { milestone: "B2", task: "nope", kind: "green", command: ["x"], cwd: ".", started: "", seconds: 0, exit: 0 })).rejects.toThrow("'nope' is not planned in B2");
  });

  test("run executes in the worktree, keeps the log under .temp and summarizes test counts", async () => {
    const { repo, trees } = await makeTracked();
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    const { record, logPath } = await runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "green", command: ["sh", "-c", "echo 'test result: ok. 12 passed; 0 failed; 1 ignored'; exit 0"] });
    expect(record.exit).toBe(0);
    expect(record.summary).toEqual({ passed: 12, failed: 0, ignored: 1 });
    expect(logPath.startsWith(join(trees["data"]!, ".temp", "data", "tally", "B2"))).toBe(true);
    expect(record.log?.bytes).toBeGreaterThan(10);
    const failed = await runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "red", command: ["sh", "-c", "exit 3"] });
    expect(failed.record.exit).toBe(3);
    expect(failed.record.summary).toBeUndefined();
    await expect(runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "red", command: ["/no/such/program"] })).rejects.toThrow(/could not start/);
  });

  test("a run returns what ran when its record cannot be written, and the log stays", async () => {
    const { repo, trees } = await makeTracked();
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    busyLock("B2.json");

    const result = await runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "clippy", command: ["sh", "-c", "echo 'warning: x'; exit 101"] });

    expect(result).toMatchObject({ recorded: false, commit: null, record: { kind: "clippy", exit: 101, command: ["sh", "-c", "echo 'warning: x'; exit 101"] } });
    expect(result.problem).toMatch(/B2\.json .*nothing was changed/);
    expect(await readFile(result.logPath, "utf8")).toBe("warning: x\n");
    expect(await listEvidence(repo, "B2", "4 manifest")).toEqual([]);
  });

  test("a run stays recorded when the landing lock keeps it from its commit", async () => {
    const { repo, trees } = await makeTracked({ commit: true });
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    busyLock("landing.lock");

    const result = await runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "green", command: ["true"] });

    expect(result).toMatchObject({ recorded: true, commit: null, record: { exit: 0 } });
    expect(result.problem).toBeUndefined();
    expect((await listEvidence(repo, "B2", "4 manifest")).map((r) => r.id)).toEqual([result.record.id]);
  });

  test("a run is refused before it starts, not after, when its record could never be written", async () => {
    const { repo, trees } = await makeTracked();
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    const touched = join(trees["data"]!, "ran.txt");
    const command = ["touch", touched];

    await expect(runEvidence(repo, data, ledger, { milestone: "B2", task: "nope", kind: "green", command })).rejects.toThrow("'nope' is not planned in B2");
    await expect(runEvidence(repo, data, ledger, { milestone: "B2", task: "T9 store", kind: "green", command })).rejects.toThrow(/may not write track engine/);

    await expect(access(touched)).rejects.toThrow();
  });

  test("summarize reads cargo's and vitest's totals", () => {
    expect(summarize("test result: ok. 5 passed; 0 failed; 0 ignored\ntest result: ok. 7 passed; 1 failed; 2 ignored\n")).toEqual({ passed: 12, failed: 1, ignored: 2 });
    expect(summarize("      Tests  1 failed | 97 passed (98)")).toEqual({ passed: 97, failed: 1, ignored: 0 });
    expect(summarize("nothing here")).toBeUndefined();
  });
});

describe("hand-offs", () => {
  test("write replaces the current note, keeps the history, and bounds the length", async () => {
    const { repo, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    expect((await readHandoff(repo, "data")).current).toBeUndefined();
    await writeHandoff(repo, data, { task: "4 manifest", lines: ["RED passes 13 assertions", "next: publication"] }, new Date("2026-11-04T00:00:00Z"));
    const { handoff } = await writeHandoff(repo, data, { lines: ["landed; next task 5"] });
    expect(handoff.current?.lines).toEqual(["landed; next task 5"]);
    expect(handoff.history.map((h) => h.task)).toEqual(["4 manifest"]);
    expect((await readHandoff(repo, "data")).current?.from).toBe("a");
    await expect(writeHandoff(repo, data, { lines: [] })).rejects.toThrow("at least one line");
    await expect(writeHandoff(repo, data, { lines: Array.from({ length: 61 }, () => "x") })).rejects.toThrow("at most 60 lines; this one has 61");
  });
});
