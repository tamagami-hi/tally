import { execFile } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RUNNER, writeRunner } from "../../src/land/runner.ts";
import { listEvidence, recordEvidence, storedKind } from "../../src/records/evidence.ts";
import { takeResults } from "../../src/records/results.ts";
import { runEvidence } from "../../src/records/run.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { makeTracked } from "../support/tracked.ts";

function runner(tree: string, args: readonly string[]): Promise<void> {
  return new Promise((done) => {
    execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, () => done());
  });
}

async function ready() {
  const tracked = await makeTracked();
  const tree = tracked.trees["data"]!;
  const data = await openSession(tracked.repo, { worktree: tree, agent: "claude" });
  return { ...tracked, tree, data };
}

const RUN = { milestone: "B2", task: "4 manifest", command: ["npm", "run", "typecheck"], started: "2026-11-20T09:00:00.000Z", seconds: 4, exit: 2 };

describe("the words for a run", () => {
  test("are kept as evidence with the word as its label, judged by nothing: the exit is the result", async () => {
    const { repo, tree, data } = await ready();

    const { record, notice } = await recordEvidence(repo, data, await new Records(repo).readLedger(), { ...RUN, cwd: tree, ...storedKind("typecheck") });

    expect(record).toMatchObject({ kind: "evidence", label: "typecheck", exit: 2 });
    expect(notice).toBeUndefined();
  });

  test("leave the nine kinds as they were, and refuse any other word with both lists", () => {
    expect(storedKind("red")).toEqual({ kind: "red" });
    expect(() => storedKind("smoke")).toThrow("'smoke' is not a kind of run: the kinds are red, green, clippy, fmt, sweep, coverage, land, evidence, other, and the words check, test, lint, typecheck, build, integration, e2e are kept as evidence with that label");
  });

  test("are taken from the runner, with its scope", async () => {
    const { repo, tree } = await ready();
    await writeRunner(repo, tree, "data");

    await runner(tree, ["e2e", "--task", "B2:4 manifest", "--scope", "the 31 tests of one module, coverage off", "--", "true"]);
    await takeResults(repo);

    expect(await listEvidence(repo, "B2", "4 manifest")).toEqual([expect.objectContaining({ kind: "evidence", label: "e2e", scope: "the 31 tests of one module, coverage off", exit: 0 })]);
  });

  test("are run by evidence_run's own path and kept with their label", async () => {
    const { repo, data } = await ready();

    const kept = await runEvidence(repo, data, await new Records(repo).readLedger(), { milestone: "B2", task: "4 manifest", kind: "lint", command: ["true"] });

    expect(kept.record).toMatchObject({ kind: "evidence", label: "lint", exit: 0 });
  });
});

describe("a run's scope", () => {
  test("is kept, and refused over 200 characters", async () => {
    const { repo, tree, data } = await ready();
    const ledger = await new Records(repo).readLedger();

    const { record } = await recordEvidence(repo, data, ledger, { ...RUN, cwd: tree, kind: "green", exit: 0, scope: "one module" });

    expect(record.scope).toBe("one module");
    await expect(recordEvidence(repo, data, ledger, { ...RUN, cwd: tree, kind: "green", exit: 0, scope: "x".repeat(201) })).rejects.toThrow("a run's scope holds at most 200 characters; this one has 201");
  });
});
