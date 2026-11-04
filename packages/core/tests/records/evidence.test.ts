import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { listEvidence, recordEvidence } from "../../src/records/evidence.ts";
import { readHandoff, writeHandoff } from "../../src/records/handoffs.ts";
import { runEvidence } from "../../src/records/run.ts";
import { summarize } from "../../src/records/totals.ts";
import { Records } from "../../src/store/records.ts";
import { openSession } from "../../src/state/sessions.ts";
import { busyLock } from "../support/busy.ts";
import { sh } from "../support/repo.ts";
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

  test("a red that exits 0 is recorded as other, and the result and the note say why", async () => {
    const { repo, trees } = await makeTracked();
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });

    const result = await runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "red", command: ["sh", "-c", "echo 'test result: ok. 4 passed; 0 failed; 0 ignored'"], note: "broken by hand" });

    expect(result.record.kind).toBe("other");
    expect(result.notice).toBe("recorded as other, not red: it exited 0");
    expect(result.record.note).toBe("recorded as other, not red: it exited 0; broken by hand");
    expect((await listEvidence(repo, "B2", "4 manifest")).map((r) => r.kind)).toEqual(["other"]);
  });

  test("a red that exits non-zero with no failed test is recorded as other", async () => {
    const { repo, trees } = await makeTracked();
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });

    const compile = await runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "red", command: ["sh", "-c", "echo 'error: could not compile'; exit 101"] });
    const collection = await runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "red", command: ["sh", "-c", "echo '=== 1 error in 0.05s ==='; exit 2"] });

    expect(compile.record).toMatchObject({ kind: "other", exit: 101, note: "recorded as other, not red: it exited 101 with no failed test, such as a compile or usage error" });
    expect(compile.notice).toBe(compile.record.note);
    expect(collection.record.kind).toBe("other");
  });

  test("a failed test in cargo's, vitest's or pytest's output keeps a run red", async () => {
    const { repo, trees } = await makeTracked();
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    const outputs = ["test result: FAILED. 0 passed; 3 failed; 0 ignored", "      Tests  1 failed (1)", "=== 2 failed, 1 passed in 0.10s ==="];

    const results = await Promise.all(outputs.map((output) => runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "red", command: ["sh", "-c", `echo '${output}'; exit 1`] })));

    expect(results.map((r) => r.record.kind)).toEqual(["red", "red", "red"]);
    expect(results.map((r) => r.notice)).toEqual([undefined, undefined, undefined]);
    expect(results.map((r) => r.record.note)).toEqual([undefined, undefined, undefined]);
  });

  test("a red run elsewhere is judged by its summary, then by its log's totals, and a green is left alone", async () => {
    const { repo, trees } = await makeTracked();
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    const run = { milestone: "B2", task: "4 manifest", command: ["x"], cwd: ".", started: "", seconds: 0 };
    await writeFile(join(trees["data"]!, "red.log"), "      Tests  2 failed (2)\n");
    await writeFile(join(trees["data"]!, "broken.log"), "error: no such option\n");

    const summed = await recordEvidence(repo, data, ledger, { ...run, kind: "red", exit: 1, summary: { failed: 1 } });
    const logged = await recordEvidence(repo, data, ledger, { ...run, kind: "red", exit: 1, logPath: "red.log" });
    const broken = await recordEvidence(repo, data, ledger, { ...run, kind: "red", exit: 1, logPath: "broken.log" });
    const bare = await recordEvidence(repo, data, ledger, { ...run, kind: "red", exit: 0 });
    const green = await recordEvidence(repo, data, ledger, { ...run, kind: "green", exit: 1 });

    expect(summed.record.kind).toBe("red");
    expect(logged.record).toMatchObject({ kind: "red", summary: { failed: 2 } });
    expect(broken.record.kind).toBe("other");
    expect(broken.notice).toMatch(/no failed test/);
    expect(bare.record.kind).toBe("other");
    expect(green.record.kind).toBe("green");
    expect(green.notice).toBeUndefined();
  });

  test("the records commit names the kind that was recorded", async () => {
    const { repo, root, trees } = await makeTracked({ commit: true });
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });

    await runEvidence(repo, data, ledger, { milestone: "B2", task: "4 manifest", kind: "red", command: ["true"] });

    expect(await sh(root, ["log", "-1", "--format=%s"])).toBe("records: B2 '4 manifest': other exit 0");
  });

  test("summarize reads cargo's totals, adding each test binary's", () => {
    expect(summarize("test result: ok. 5 passed; 0 failed; 0 ignored\ntest result: FAILED. 7 passed; 1 failed; 2 ignored; 0 measured; 0 filtered out; finished in 0.01s\n")).toEqual({ passed: 12, failed: 1, ignored: 2 });
  });

  test("summarize reads vitest's totals, with or without passes and in colour", () => {
    expect(summarize("      Tests  1 failed | 97 passed (98)")).toEqual({ passed: 97, failed: 1, ignored: 0 });
    expect(summarize("      Tests  3 failed (3)")).toEqual({ passed: 0, failed: 3, ignored: 0 });
    expect(summarize("      Tests  2 failed | 5 passed | 1 skipped | 1 todo (9)")).toEqual({ passed: 5, failed: 2, ignored: 2 });
    expect(summarize("\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[31m1 failed\u001b[39m\u001b[22m\u001b[2m | \u001b[22m\u001b[1m\u001b[32m4 passed\u001b[39m\u001b[22m\u001b[90m (5)\u001b[39m")).toEqual({ passed: 4, failed: 1, ignored: 0 });
    expect(summarize(" Test Files  1 failed (1)\n      Tests  no tests\n")).toBeUndefined();
  });

  test("summarize reads pytest's totals, in every verbosity", () => {
    expect(summarize("============ 2 failed, 5 passed, 1 skipped, 1 xfailed, 3 warnings in 0.12s ============")).toEqual({ passed: 5, failed: 2, ignored: 2 });
    expect(summarize("3 passed in 0.01s")).toEqual({ passed: 3, failed: 0, ignored: 0 });
    expect(summarize("1 failed in 65.21s (0:01:05)")).toEqual({ passed: 0, failed: 1, ignored: 0 });
    expect(summarize("=== 1 xfailed, 1 xpassed in 0.01s ===")).toEqual({ passed: 0, failed: 0, ignored: 1 });
    expect(summarize("=========== 1 error in 0.05s ===========")).toEqual({ passed: 0, failed: 0, ignored: 0 });
  });

  test("summarize finds no totals in what no runner printed", () => {
    expect(summarize("nothing here")).toBeUndefined();
    expect(summarize("error: could not compile `core` (lib test) due to 2 previous errors")).toBeUndefined();
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
