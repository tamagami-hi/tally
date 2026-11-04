import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { findMilestone, findTask } from "../../src/ledger/items.ts";
import { landingTarget, recordLanding } from "../../src/land/record.ts";
import { landTrack, type LandDeps, type Landed } from "../../src/land/run.ts";
import { Records } from "../../src/store/records.ts";
import { claimTask, listClaims } from "../../src/state/claims.ts";
import { openSession } from "../../src/state/sessions.ts";
import { busyLock } from "../support/busy.ts";
import { sh } from "../support/repo.ts";
import { makeTracked, type Tracked } from "../support/tracked.ts";

const deps: LandDeps = { runTests: async () => undefined, log: () => undefined };

async function landOne(tracked: Tracked): Promise<Landed> {
  const tree = tracked.trees["data"]!;
  await mkdir(join(tree, ".temp"), { recursive: true });
  await writeFile(join(tree, "new.rs"), "x\n");
  await writeFile(join(tree, ".temp", "message.txt"), "feat(data): the task\n");
  return landTrack(tracked.repo, { track: "data", files: ["new.rs"], messageFile: join(tree, ".temp", "message.txt") }, deps);
}

async function taskOf(tracked: Tracked, milestone: string, task: string) {
  return findTask(findMilestone(await new Records(tracked.repo).readLedger(), milestone), task);
}

describe("recording a landing", () => {
  test("records the task at the hash the landing made and releases its claim", async () => {
    const tracked = await makeTracked();
    const ledger = await new Records(tracked.repo).readLedger();
    const session = await openSession(tracked.repo, { worktree: tracked.trees["data"]!, track: "data", agent: "a" });
    await claimTask(tracked.repo, session, ledger, "B2", "4 manifest");
    const landed = await landOne(tracked);

    const result = await recordLanding(tracked.repo, landed, { milestone: "B2", task: "4 manifest" }, session);

    expect(result).toEqual({ recorded: true, message: `B2 '4 manifest': landed at ${landed.head}`, commit: null });
    expect(await taskOf(tracked, "B2", "4 manifest")).toMatchObject({ status: "landed", commit: landed.head, also: [] });
    expect(await listClaims(tracked.repo)).toEqual([]);
  });

  test("a landing of several commits names the earlier ones in also, so the ledger stays covered", async () => {
    const tracked = await makeTracked();
    const tree = tracked.trees["data"]!;
    await writeFile(join(tree, "first.rs"), "x\n");
    await sh(tree, ["add", "first.rs"]);
    await sh(tree, ["commit", "-q", "-m", "feat(data): first"]);
    const first = await sh(tree, ["rev-parse", "--short=7", "HEAD"]);

    const landed = await landOne(tracked);
    await recordLanding(tracked.repo, landed, { milestone: "B2", task: "4 manifest" });

    expect(landed.commits).toEqual([first, landed.head]);
    expect(await taskOf(tracked, "B2", "4 manifest")).toMatchObject({ commit: landed.head, also: [first] });
  });

  test("says so plainly, with the commit, when the task cannot be recorded, and does not throw", async () => {
    const tracked = await makeTracked();
    const landed = await landOne(tracked);

    const result = await recordLanding(tracked.repo, landed, { milestone: "B9", task: "x" });

    expect(result.recorded).toBe(false);
    expect(result.commit).toBeNull();
    expect(result.message).toBe(`landed at ${landed.head}, but recording B9 'x' failed: no milestone 'B9'; known: B2; finish it with tally task land B9 'x' ${landed.head}`);
  });

  test("a track session may not record another track's task, and is told so with the commit", async () => {
    const tracked = await makeTracked();
    const session = await openSession(tracked.repo, { worktree: tracked.trees["data"]!, track: "data", agent: "a" });
    const landed = await landOne(tracked);

    const result = await recordLanding(tracked.repo, landed, { milestone: "B2", task: "T9 store" }, session);

    expect(result.recorded).toBe(false);
    expect(result.message).toContain(landed.head);
    expect(result.message).toMatch(/may not write track engine/);
    expect(await taskOf(tracked, "B2", "T9 store")).toMatchObject({ status: "planned" });
  });

  test("a landing that brought nothing new records nothing", async () => {
    const tracked = await makeTracked();

    const landed = await landTrack(tracked.repo, { track: "data", files: [] }, deps);
    const result = await recordLanding(tracked.repo, landed, { milestone: "B2", task: "4 manifest" });

    expect(landed.commits).toEqual([]);
    expect(result).toEqual({ recorded: false, message: "nothing new landed, so B2 '4 manifest' is not recorded", commit: null });
    expect(await taskOf(tracked, "B2", "4 manifest")).toMatchObject({ status: "planned" });
  });

  test("a claim it could not release leaves the record standing and says the claim is held", async () => {
    const tracked = await makeTracked();
    const landed = await landOne(tracked);
    busyLock("claims.json");

    const result = await recordLanding(tracked.repo, landed, { milestone: "B2", task: "4 manifest" });

    expect(result.recorded).toBe(true);
    expect(result.problem).toMatch(/^its claim is still held: could not take the lock claims\.json/);
    expect(await taskOf(tracked, "B2", "4 manifest")).toMatchObject({ commit: landed.head });
  });

  test("a records commit the landing lock holds back leaves the task recorded", async () => {
    const tracked = await makeTracked({ commit: true });
    const landed = await landOne(tracked);
    busyLock("landing.lock");

    const result = await recordLanding(tracked.repo, landed, { milestone: "B2", task: "4 manifest" });

    expect(result).toEqual({ recorded: true, message: `B2 '4 manifest': landed at ${landed.head}`, commit: null });
  });
});

describe("naming the task of a landing", () => {
  test("takes both the milestone and the task or neither, as a usage error", () => {
    expect(landingTarget(undefined, undefined)).toBeUndefined();
    expect(landingTarget("B2", "x")).toEqual({ milestone: "B2", task: "x" });
    expect(() => landingTarget("B2", undefined)).toThrow("a landing records a task from both its milestone and its task");
    expect(() => landingTarget(undefined, "x")).toThrow(expect.objectContaining({ exit: 2 }));
  });
});
