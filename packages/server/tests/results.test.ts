import { execFile } from "node:child_process";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, test } from "vitest";
import { Watcher } from "../src/watcher.ts";
import { RUNNER, writeRunner } from "../../core/src/land/runner.ts";
import { listEvidence } from "../../core/src/records/evidence.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

const PATIENCE_MS = 3000;
const STEP_MS = 40;

describe("the watcher and the runner", () => {
  test("a run made in a worktree becomes a record on the watcher's next tick, and the board hears of it", async () => {
    const { repo, trees } = await makeTracked();
    const tree = trees["data"] ?? "";
    await writeRunner(repo, tree, "data");
    const watcher = new Watcher(repo, { intervalMs: STEP_MS });
    await watcher.current();
    let heard = 0;
    watcher.subscribe(() => {
      heard += 1;
    });
    watcher.start();

    await new Promise<void>((done) => execFile("sh", [join(tree, RUNNER), "green", "--task", "B2:4 manifest", "--", "true"], { cwd: tree }, () => done()));
    const until = Date.now() + PATIENCE_MS;
    while ((await listEvidence(repo, "B2", "4 manifest")).length === 0 && Date.now() < until) await delay(STEP_MS);
    while (heard === 0 && Date.now() < until) await delay(STEP_MS);
    await watcher.stop();

    expect(await listEvidence(repo, "B2", "4 manifest")).toHaveLength(1);
    expect(heard).toBeGreaterThan(0);
  });
});
