import { execFile } from "node:child_process";
import { mkdir, readFile, realpath, utimes, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { RUNNER, writeRunner } from "../../src/land/runner.ts";
import { evidencePath, listEvidence, readEvidence, recordEvidence } from "../../src/records/evidence.ts";
import { takeResults } from "../../src/records/results.ts";
import { runEvidence } from "../../src/records/run.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { sh } from "../support/repo.ts";
import { makeTracked, type Tracked } from "../support/tracked.ts";

const TOUCHED = new Date("2026-11-01T09:00:00.000Z");

function runner(tree: string, from: string, args: readonly string[]): Promise<void> {
  return new Promise((done) => {
    execFile("sh", [join(tree, RUNNER), ...args], { cwd: from }, () => done());
  });
}

async function ready(): Promise<Tracked & { tree: string }> {
  const tracked = await makeTracked();
  const tree = tracked.trees["data"] ?? "";
  await writeRunner(tracked.repo, tree, "data");
  return { ...tracked, tree };
}

async function recordedFrom(tracked: Tracked & { tree: string }, from = tracked.tree) {
  await runner(tracked.tree, from, ["green", "--task", "B2:4 manifest", "--", "true"]);
  await takeResults(tracked.repo);
  return (await listEvidence(tracked.repo, "B2", "4 manifest")).at(-1);
}

describe("a run made through the runner", () => {
  test("records the folder the command ran in, below the worktree", async () => {
    const tracked = await ready();
    const unit = join(tracked.tree, "crates", "core");
    await mkdir(unit, { recursive: true });

    const record = await recordedFrom(tracked, unit);

    expect(record?.cwd).toBe(await realpath(unit));
  });

  test("records the head of a clean worktree, and that it was clean", async () => {
    const tracked = await ready();

    const record = await recordedFrom(tracked);

    expect(record).toMatchObject({ head: await sh(tracked.tree, ["rev-parse", "HEAD"]), dirty: false });
  });

  test("records dirty for an edited tracked file and for a file git does not know", async () => {
    const tracked = await ready();
    await writeFile(join(tracked.tree, "RULES.md"), "# Rules, edited\n");
    const edited = await recordedFrom(tracked);
    await sh(tracked.tree, ["checkout", "--", "RULES.md"]);
    await writeFile(join(tracked.tree, "new.rs"), "fn main() {}\n");

    const untracked = await recordedFrom(tracked);

    expect([edited?.dirty, untracked?.dirty]).toEqual([true, true]);
  });

  test("does not count what tally keeps in the worktree, where .temp/ is not ignored", async () => {
    const tracked = await ready();
    await writeFile(join(tracked.tree, ".gitignore"), "target/\n");
    await sh(tracked.tree, ["commit", "-q", "-am", "chore: stop ignoring .temp"]);
    await mkdir(join(tracked.tree, ".temp", "data", "tally", "B2"), { recursive: true });
    await writeFile(join(tracked.tree, ".temp", "data", "tally", "B2", "a.log"), "ran\n");
    await recordedFrom(tracked);

    const record = await recordedFrom(tracked);

    expect(record?.dirty).toBe(false);
  });

  test("leaves the repository's index and objects as they were, though a file's time changed", async () => {
    const tracked = await ready();
    await writeFile(join(tracked.tree, "new.rs"), "fn main() {}\n");
    await utimes(join(tracked.tree, "RULES.md"), TOUCHED, TOUCHED);
    const index = resolve(tracked.tree, await sh(tracked.tree, ["rev-parse", "--git-path", "index"]));
    const [objects, before] = [await sh(tracked.root, ["count-objects", "-v"]), await readFile(index)];

    await runner(tracked.tree, tracked.tree, ["green", "--task", "B2:4 manifest", "--", "true"]);

    expect(await sh(tracked.root, ["count-objects", "-v"])).toBe(objects);
    expect((await readFile(index)).equals(before)).toBe(true);
  });
});

describe("a run made by the service", () => {
  test("records the head and whether the worktree was dirty, and a run recorded by hand has neither", async () => {
    const tracked = await ready();
    const session = await openSession(tracked.repo, { worktree: tracked.tree, track: "data", agent: "a" });
    const ledger = await new Records(tracked.repo).readLedger();
    await writeFile(join(tracked.tree, "new.rs"), "fn main() {}\n");

    const ran = await runEvidence(tracked.repo, session, ledger, { milestone: "B2", task: "4 manifest", kind: "green", command: ["true"] });
    const byHand = await recordEvidence(tracked.repo, session, ledger, { milestone: "B2", task: "4 manifest", kind: "green", command: ["x"], cwd: ".", started: "", seconds: 0, exit: 0 });

    expect(ran.record).toMatchObject({ head: await sh(tracked.tree, ["rev-parse", "HEAD"]), dirty: true });
    expect(byHand.record.head).toBeUndefined();
    expect(byHand.record.dirty).toBeUndefined();
  });
});

describe("an older run record", () => {
  test("with neither field still reads", async () => {
    const tracked = await ready();
    await mkdir(join(tracked.repo.recordsDir, "evidence"), { recursive: true });
    const older = { id: "a".repeat(32), task: "4 manifest", track: "data", agent: "a", kind: "green", command: ["true"], cwd: tracked.tree, started: "2026-11-16T09:00:00Z", seconds: 1, exit: 0 };
    await writeFile(evidencePath(tracked.repo, "B2"), JSON.stringify({ schema: 1, milestone: "B2", records: [older] }));

    expect((await readEvidence(tracked.repo, "B2")).records).toEqual([older]);
  });
});
