import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RESULTS, RUNNER } from "../../src/land/runner.ts";
import { listEvidence } from "../../src/records/evidence.ts";
import { takeResults } from "../../src/records/results.ts";
import { openSession } from "../../src/state/sessions.ts";
import { collect } from "../../src/status/collect.ts";
import { Records } from "../../src/store/records.ts";
import { startTrial } from "../../src/trials/start.ts";
import { AT, trialling } from "../support/trialling.ts";

function run(tree: string, args: readonly string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((done) => {
    execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, (error, _stdout, stderr) => done({ code: error === null ? 0 : typeof error.code === "number" ? error.code : 1, stderr }));
  });
}

async function started() {
  const made = await trialling();
  const trial = await startTrial(made.repo, made.operator, { name: "both", tracks: ["engine", "data"] }, AT);
  return { ...made, trial };
}

describe("runs in a trial", () => {
  test("are refused by its runner without --task, and nothing is left to take", async () => {
    const { trial } = await started();

    const ran = await run(trial.worktree, ["green", "--", "true"]);

    expect(ran).toEqual({ code: 2, stderr: "tally: a run in a trial names its task: --task MILESTONE:TASK\n" });
    expect(await readdir(join(trial.worktree, RESULTS)).catch(() => [])).toEqual([]);
  });

  test("are recorded against the task named, with the trial's name and head", async () => {
    const { repo, trial } = await started();
    await run(trial.worktree, ["green", "--task", "B2:4 manifest", "--", "sh", "-c", "echo '3 passed; 0 failed'"]);

    const taken = await takeResults(repo);

    expect(taken.map((one) => one.problem)).toEqual([undefined]);
    expect(await listEvidence(repo, "B2", "4 manifest")).toEqual([expect.objectContaining({ kind: "green", trial: { name: "both", head: trial.head }, cwd: trial.worktree })]);
  });

  test("land nothing: no session opens in a trial's checkout", async () => {
    const { repo, trial } = await started();

    await expect(openSession(repo, { worktree: trial.worktree, agent: "kiro" })).rejects.toThrow(`${trial.worktree} is the checkout of the trial both: a trial lands nothing and opens no session; run its checks with its runner and --task`);
  });

  test("leave a trial open for more than a day as one of the repository's problems", async () => {
    const { repo } = await started();
    const ledger = await new Records(repo).readLedger();

    const today = await collect(repo, ledger, new Date(AT.getTime() + 60_000));
    const tomorrow = await collect(repo, ledger, new Date(AT.getTime() + 25 * 3_600_000));

    expect(today.problems.filter((problem) => problem.includes("trial"))).toEqual([]);
    expect(tomorrow.problems.filter((problem) => problem.includes("trial"))).toEqual([`the trial both has been open since ${AT.toISOString()}: end it with trial_end once its checks are read`]);
  });
});
