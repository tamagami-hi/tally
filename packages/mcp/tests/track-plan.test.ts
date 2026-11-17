import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { gitOut } from "../../core/src/git/run.ts";
import { Records } from "../../core/src/store/records.ts";
import { busyLock } from "../../core/tests/support/busy.ts";
import { makeTracked, type Tracked } from "../../core/tests/support/tracked.ts";
import { connect, opened, type Call } from "./support/connect.ts";

const lane = { name: "lane", purpose: "the reader's second half" };
const isThere = (path: string): Promise<boolean> => stat(path).then(() => true, () => false);

async function serving(): Promise<Tracked & { call: Call; operator: string }> {
  const tracked = await makeTracked();
  const { call } = await connect(tracked.repo);
  return { ...tracked, call, operator: await opened(call, tracked.root, "operator") };
}

const tracksOf = async (tracked: Tracked, milestone: string): Promise<Record<string, string>> => {
  const found = (await new Records(tracked.repo).readLedger()).milestones.find((one) => one.id === milestone);
  return Object.fromEntries((found?.tasks ?? []).map((task) => [task.id, task.track]));
};

async function nothingMade(tracked: Tracked): Promise<void> {
  expect(await gitOut(tracked.root, ["rev-parse", "--verify", "-q", "refs/heads/track/lane"])).toBeNull();
  expect(await isThere(join(tracked.root, ".temp/worktrees/lane"))).toBe(false);
  expect(await isThere(join(tracked.repo.recordsDir, "tracks.json"))).toBe(false);
}

describe("track_open with a plan", () => {
  test("plans the tasks on the new track, and a session there claims one", async () => {
    const tracked = await serving();

    const made = await tracked.call("track_open", { sessionId: tracked.operator, ...lane, plan: { milestone: "B2", tasks: ["7 split", { id: "8 index", brief: "build the index", paths: ["src/index.rs"] }] } });

    expect(made.isError).toBe(false);
    expect(made.structured).toMatchObject({ name: "lane", planned: "B2: planned 2 new task(s): 7 split, 8 index" });
    expect(made.structured["planProblem"]).toBeUndefined();
    expect(await tracksOf(tracked, "B2")).toMatchObject({ "7 split": "lane", "8 index": "lane" });
    const there = await opened(tracked.call, made.structured["worktree"] as string, "sonnet");
    const claim = await tracked.call("task_claim", { sessionId: there, milestone: "B2", task: "7 split" });
    expect(claim.isError).toBe(false);
  });

  test("refuses a milestone that is built before any branch or worktree exists", async () => {
    const tracked = await serving();
    const ledger = await new Records(tracked.repo).readLedger();
    await new Records(tracked.repo).writeLedger({ ...ledger, milestones: ledger.milestones.map((one) => ({ ...one, built: "2026-11-16" })) });

    const refused = await tracked.call("track_open", { sessionId: tracked.operator, ...lane, plan: { milestone: "B2", tasks: ["7 split"] } });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("B2 is already built");
    await nothingMade(tracked);
  });

  test("refuses a milestone of a closed phase, or one that does not exist, making nothing", async () => {
    const tracked = await serving();
    await writeFile(join(tracked.repo.recordsDir, "phases.json"), JSON.stringify({ schema: 1, phases: [{ id: "B", closedAt: "2026-11-16T10:00:00.000Z", summary: "widened" }] }));

    const closed = await tracked.call("track_open", { sessionId: tracked.operator, ...lane, plan: { milestone: "B2", tasks: ["7 split"] } });
    const missing = await tracked.call("track_open", { sessionId: tracked.operator, ...lane, plan: { milestone: "Z9", tasks: ["7 split"] } });

    expect(closed.text).toContain("phase B is closed");
    expect(missing.isError).toBe(true);
    await nothingMade(tracked);
  });

  test("refuses a task that covers what the milestone does not deliver, making nothing", async () => {
    const tracked = await serving();

    const refused = await tracked.call("track_open", { sessionId: tracked.operator, ...lane, plan: { milestone: "B2", tasks: [{ id: "7 split", covers: ["d9"] }] } });

    expect(refused.text).toContain("B2 delivers no 'd9'");
    await nothingMade(tracked);
  });

  test("keeps the track open and says why when the plan fails after the track is made", async () => {
    const tracked = await serving();
    busyLock("ledger.json");

    const made = await tracked.call("track_open", { sessionId: tracked.operator, ...lane, plan: { milestone: "B2", tasks: ["7 split"] } });

    expect(made.isError).toBe(false);
    expect(made.structured["planned"]).toBeUndefined();
    expect(made.structured["planProblem"]).toMatch(/ledger\.json/);
    expect(await isThere(join(tracked.root, ".temp/worktrees/lane"))).toBe(true);
  });

  test("lets a track's session plan its child's tasks, as task_plan would", async () => {
    const tracked = await serving();
    const data = await opened(tracked.call, tracked.trees["data"] ?? "");

    const made = await tracked.call("track_open", { sessionId: data, ...lane, plan: { milestone: "B2", tasks: ["7 split"] } });

    expect(made.structured).toMatchObject({ parent: "data", planned: "B2: planned 1 new task(s): 7 split" });
    expect((await tracksOf(tracked, "B2"))["7 split"]).toBe("lane");
  });
});

describe("task_plan from an operator session with no track", () => {
  test("says the tasks went to the main branch's track while lanes are open", async () => {
    const tracked = await serving();
    await tracked.call("track_open", { sessionId: tracked.operator, ...lane });

    const planned = await tracked.call("task_plan", { sessionId: tracked.operator, milestone: "B2", tasks: ["9 later"] });

    expect(planned.isError).toBe(false);
    expect(planned.structured["notice"]).toBe("these tasks are on main, the main branch's track, as no track was given; the tracks opened with track_open are lane; give track to plan tasks on one of them");
    expect((await tracksOf(tracked, "B2"))["9 later"]).toBe("main");
  });

  test("says nothing when no track opened with track_open is open, when track is given, or from a lane", async () => {
    const tracked = await serving();
    const quiet = await tracked.call("task_plan", { sessionId: tracked.operator, milestone: "B2", tasks: ["9 later"] });
    await tracked.call("track_open", { sessionId: tracked.operator, ...lane });
    const given = await tracked.call("task_plan", { sessionId: tracked.operator, milestone: "B2", track: "lane", tasks: ["10 lane"] });
    const data = await opened(tracked.call, tracked.trees["data"] ?? "");
    const fromLane = await tracked.call("task_plan", { sessionId: data, milestone: "B2", tasks: ["11 data"] });

    expect([quiet, given, fromLane].map((answer) => answer.structured["notice"])).toEqual([undefined, undefined, undefined]);
    expect([quiet, given, fromLane].map((answer) => answer.isError)).toEqual([false, false, false]);
  });
});
