import { describe, expect, test } from "vitest";
import { land, other, plan, wait } from "../../src/ledger/ops.ts";
import type { Ledger } from "../../src/schema/ledger.ts";

const resolve = async (commit: string): Promise<string> => {
  if (commit.startsWith("bad")) throw new Error(`${commit} is not on main yet; record it after it lands`);
  return commit.slice(0, 7);
};

const base = (): Ledger => ({
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [
    { id: "B2", stage: "B", name: "replay store", track: "data+product", weight: 11, tasks: [
      { id: "existing task", track: "data", status: "landed", commit: "abc1234", also: [] },
      { id: "B2 data close", track: "data", status: "planned", also: [] },
    ] },
    { id: "B1", stage: "B", name: "matrix reader", track: "data", weight: 7, built: "6752fe4..dd43951", tasks: [] },
  ],
  other: [],
});

describe("plan", () => {
  test("adds new tasks before the unfinished close and skips the ones already planned", () => {
    const first = plan(base(), { milestone: "B2", track: "product", tasks: ["product transcode job"] });
    expect(first.message).toBe("B2: planned 1 new task(s): product transcode job");
    const ids = first.ledger.milestones[0]!.tasks.map((t) => t.id);
    expect(ids).toEqual(["existing task", "product transcode job", "B2 data close"]);
    const again = plan(first.ledger, { milestone: "B2", track: "product", tasks: ["product transcode job"] });
    expect(again.message).toBe("B2: planned 0 new task(s)");
    expect(again.ledger.milestones[0]!.tasks).toHaveLength(3);
  });

  test("plans a close last even when it is given first", () => {
    const empty = { ...base(), milestones: [{ ...base().milestones[0]!, tasks: [] }] };
    const planned = plan(empty, { milestone: "B2", track: "data", tasks: ["B2 data close", "first", "second"] });
    expect(planned.ledger.milestones[0]!.tasks.map((t) => t.id)).toEqual(["first", "second", "B2 data close"]);
  });

  test("moves an unfinished close that was appended out of order back to the end", () => {
    const ledger: Ledger = { ...base(), milestones: [{ ...base().milestones[0]!, id: "B4", tasks: [
      { id: "data part close", track: "data", status: "landed", commit: "37666b0", also: [] },
      { id: "B4 close", track: "engine", status: "planned", also: [] },
      { id: "product replay session", track: "product", status: "planned", also: [], waits: "B8" },
    ] }] };
    const planned = plan(ledger, { milestone: "B4", track: "product", tasks: ["product replay session"] });
    expect(planned.ledger.milestones[0]!.tasks.map((t) => t.id)).toEqual(["data part close", "product replay session", "B4 close"]);
  });

  test("refuses a built milestone", () => {
    expect(() => plan(base(), { milestone: "B1", track: "data", tasks: ["x"] })).toThrow("B1 is already built");
  });
});

describe("land", () => {
  test("records the commit, clears the wait and merges the also list", async () => {
    const waiting = wait(base(), { milestone: "B2", task: "B2 data close", what: "product" }).ledger;
    const landed = await land(waiting, { milestone: "B2", task: "B2 data close", commit: "0123456789ab", also: ["fedcba9876"] }, resolve);
    const task = landed.ledger.milestones[0]!.tasks[1]!;
    expect(task).toEqual({ id: "B2 data close", track: "data", status: "landed", commit: "0123456", also: ["fedcba9"] });
    expect(landed.message).toBe("B2 'B2 data close': landed at 0123456");
  });

  test("an unplanned task is added before the close with the milestone's one track", async () => {
    const ledger = { ...base(), milestones: [{ ...base().milestones[0]!, track: "data" }] };
    const landed = await land(ledger, { milestone: "B2", task: "new follow-up task", commit: "def5678abcdef" }, resolve);
    const tasks = landed.ledger.milestones[0]!.tasks;
    expect(tasks[tasks.length - 1]!.id).toBe("B2 data close");
    expect(tasks[tasks.length - 2]).toEqual({ id: "new follow-up task", track: "data", status: "landed", commit: "def5678", also: [] });
  });

  test("an unplanned task in a shared milestone needs its track", async () => {
    await expect(land(base(), { milestone: "B2", task: "orphan", commit: "def5678abcdef" }, resolve))
      .rejects.toThrow("'orphan' is not planned in B2; give --track");
  });

  test("a commit that is not on main is refused before anything changes", async () => {
    await expect(land(base(), { milestone: "B2", task: "B2 data close", commit: "bad0000" }, resolve))
      .rejects.toThrow("bad0000 is not on main yet; record it after it lands");
  });
});

describe("wait and other", () => {
  test("wait marks a planned task and refuses an unknown one", () => {
    const waited = wait(base(), { milestone: "B2", task: "B2 data close", what: "product transcode job" });
    expect(waited.ledger.milestones[0]!.tasks[1]!.waits).toBe("product transcode job");
    expect(waited.message).toBe("B2 'B2 data close': waits for product transcode job");
    expect(() => wait(base(), { milestone: "B2", task: "nope", what: "x" })).toThrow("'nope' is not planned in B2");
  });

  test("other records a commit once, replacing an earlier note for the same commit", async () => {
    const once = await other(base(), { commit: "bf8e9930000", note: "rule: the progress ledger" }, resolve);
    const twice = await other(once.ledger, { commit: "bf8e9930000", note: "corrected" }, resolve);
    expect(twice.ledger.other).toEqual([{ commit: "bf8e993", note: "corrected" }]);
    expect(once.message).toBe("bf8e993: recorded as 'rule: the progress ledger'");
  });
});
