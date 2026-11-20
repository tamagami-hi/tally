import { execFile } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { startService } from "../src/serve.ts";
import { RUNNER, writeRunner } from "../../core/src/land/runner.ts";
import { listEvidence } from "../../core/src/records/evidence.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { openRepo } from "../../core/src/store/records.ts";
import { stateDirOf } from "../../core/src/repos/home.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

function runner(tree: string, args: readonly string[]): Promise<void> {
  return new Promise((done) => {
    execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, () => done());
  });
}

const WAIT = { timeout: 3_500, interval: 100 };

async function waiting(name: string) {
  const home = await tmpDir("tally-home-");
  const { root, trees } = await makeTracked();
  const tree = trees["data"]!;
  const repo = { ...(await openRepo(root)), name, stateDir: stateDirOf(home, name) };
  await writeRunner(repo, tree, "data");
  await runner(tree, ["green", "--task", "B2:4 manifest", "--", "true"]);
  return { home, root, repo };
}

describe("a service keeps house from the start", () => {
  test("takes in a runner result of a listed repository with no call made to it", async () => {
    const { home, root, repo } = await waiting("alpha");
    await addRepo(home, { root, name: "alpha" });

    const running = await startService({ home, workspace: root, port: 0, host: "127.0.0.1", webDir: root, intervalMs: 50 });
    try {
      await vi.waitFor(async () => expect(await listEvidence(repo, "B2", "4 manifest")).toHaveLength(1), WAIT);
    } finally {
      await running.close();
    }
  });

  test("starts watching a repository added after it started, with no call made to it", async () => {
    const home = await tmpDir("tally-home-");
    const running = await startService({ home, workspace: home, port: 0, host: "127.0.0.1", webDir: home, intervalMs: 50 });
    try {
      const { root, repo } = await waiting("beta");
      await addRepo(home, { root, name: "beta" });

      await vi.waitFor(async () => expect(await listEvidence(repo, "B2", "4 manifest")).toHaveLength(1), WAIT);
    } finally {
      await running.close();
    }
  });
});
