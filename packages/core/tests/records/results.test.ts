import { execFile } from "node:child_process";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RESULTS, RUNNER, writeRunner } from "../../src/land/runner.ts";
import { listEvidence } from "../../src/records/evidence.ts";
import { takeResults } from "../../src/records/results.ts";
import { claimTask } from "../../src/state/claims.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { makeTracked, type Tracked } from "../support/tracked.ts";

function run(tree: string, args: readonly string[]): Promise<void> {
  return new Promise((done) => {
    execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, () => done());
  });
}

async function ready(): Promise<Tracked & { tree: string }> {
  const tracked = await makeTracked();
  const tree = tracked.trees["data"] ?? "";
  await writeRunner(tracked.repo, tree, "data");
  return { ...tracked, tree };
}

const left = async (tree: string, folder: string): Promise<string[]> => readdir(join(tree, RESULTS, folder)).catch(() => []);

describe("taking the runner's results in", () => {
  test("writes the run record with its command, exit and hashed log, and puts the result away", async () => {
    const { repo, tree } = await ready();
    await run(tree, ["green", "--task", "B2:4 manifest", "--", "sh", "-c", "echo 'test result: ok. 3 passed; 0 failed'"]);

    const taken = await takeResults(repo);

    expect(taken).toHaveLength(1);
    expect(taken[0]?.problem).toBeUndefined();
    const [record] = await listEvidence(repo, "B2", "4 manifest");
    expect(record).toMatchObject({ task: "4 manifest", track: "data", kind: "green", command: ["sh", "-c", "echo 'test result: ok. 3 passed; 0 failed'"], cwd: tree, exit: 0, agent: "runner" });
    expect(record?.log?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(record?.log?.path ?? "", "utf8")).toContain("3 passed");
    expect(await left(tree, "taken")).toHaveLength(1);
  });

  test("names the agent of the session that is open in the worktree", async () => {
    const { repo, tree } = await ready();
    await openSession(repo, { worktree: tree, agent: "claude" });
    await run(tree, ["green", "--task", "B2:4 manifest", "--", "true"]);

    await takeResults(repo);

    expect((await listEvidence(repo, "B2", "4 manifest"))[0]?.agent).toBe("claude");
  });

  test("files a run with no task under the task its session holds", async () => {
    const { repo, tree } = await ready();
    const session = await openSession(repo, { worktree: tree, agent: "claude" });
    await claimTask(repo, session, await new Records(repo).readLedger(), "B2", "5 transcoder");
    await run(tree, ["fmt", "--", "true"]);

    await takeResults(repo);

    expect((await listEvidence(repo, "B2", "5 transcoder")).map((record) => record.kind)).toEqual(["fmt"]);
  });

  test("sets aside a run with no task when nothing is claimed, and says why", async () => {
    const { repo, tree } = await ready();
    await run(tree, ["green", "--", "true"]);

    const taken = await takeResults(repo);

    expect(taken[0]?.problem).toBe("the run names no task, and no session in this worktree holds one; pass --task MILESTONE:TASK");
    const [id] = await left(tree, "refused");
    expect(await readFile(join(tree, RESULTS, "refused", id ?? "", "problem"), "utf8")).toContain("names no task");
    expect(await listEvidence(repo, "B2")).toEqual([]);
  });

  test("sets aside a run for a task that is not planned", async () => {
    const { repo, tree } = await ready();
    await run(tree, ["green", "--task", "B2:no such task", "--", "true"]);

    const taken = await takeResults(repo);

    expect(taken[0]?.problem).toBe("'no such task' is not planned in B2");
    expect(await left(tree, "refused")).toHaveLength(1);
  });

  test("sets aside a run of a kind it does not know", async () => {
    const { repo, tree } = await ready();
    await run(tree, ["sideways", "--task", "B2:4 manifest", "--", "true"]);

    const taken = await takeResults(repo);

    expect(taken[0]?.problem).toContain("'sideways' is not a kind of run");
  });

  test("keeps a red that did not fail as another kind, and says so", async () => {
    const { repo, tree } = await ready();
    await run(tree, ["red", "--task", "B2:4 manifest", "--", "true"]);

    const taken = await takeResults(repo);

    expect(taken[0]?.notice).toBe("recorded as other, not red: it exited 0");
    expect((await listEvidence(repo, "B2", "4 manifest"))[0]?.kind).toBe("other");
  });

  test("leaves a result that is still being written", async () => {
    const { repo, tree } = await ready();
    await mkdir(join(tree, RESULTS, "20261112T100000Z-1.tmp"), { recursive: true });

    expect(await takeResults(repo)).toEqual([]);
    expect(await readdir(join(tree, RESULTS))).toEqual(["20261112T100000Z-1.tmp"]);
  });

  test("takes each result once", async () => {
    const { repo, tree } = await ready();
    await run(tree, ["green", "--task", "B2:4 manifest", "--", "true"]);
    await takeResults(repo);

    expect(await takeResults(repo)).toEqual([]);
    expect(await listEvidence(repo, "B2", "4 manifest")).toHaveLength(1);
  });

  test("takes results from every track's worktree and from the repository's own checkout", async () => {
    const { repo, tree, root, trees } = await ready();
    await writeRunner(repo, trees["engine"] ?? "", "engine");
    await writeRunner(repo, root, "main");
    await run(tree, ["green", "--task", "B2:4 manifest", "--", "true"]);
    await run(trees["engine"] ?? "", ["green", "--task", "B2:T9 store", "--", "true"]);
    await run(root, ["sweep", "--task", "B2:4 manifest", "--", "true"]);

    const taken = await takeResults(repo);

    expect(taken.map((one) => one.problem)).toEqual([undefined, undefined, undefined]);
    expect((await listEvidence(repo, "B2")).map((record) => `${record.track}:${record.kind}`).sort()).toEqual(["data:green", "data:sweep", "engine:green"]);
  });
});
