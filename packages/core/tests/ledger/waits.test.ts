import { describe, expect, test } from "vitest";
import { land, unwait, wait } from "../../src/ledger/ops.ts";
import type { Ledger, Task } from "../../src/schema/ledger.ts";

const resolve = async (commit: string): Promise<string> => commit.slice(0, 7);

const base = (): Ledger => ({
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [
    { id: "B2", stage: "B", name: "store", track: "data+engine", weight: 1, tasks: [
      { id: "1 reader", track: "data", status: "landed", commit: "abc1234", also: [] },
      { id: "5 transcoder", track: "data", status: "planned", also: [] },
      { id: "T9 store", track: "engine", status: "planned", also: [] },
    ] },
    { id: "B4", stage: "B", name: "simulator", track: "engine", weight: 1, tasks: [
      { id: "T1 fills", track: "engine", status: "planned", also: [] },
    ] },
  ],
  other: [],
});

const taskOf = (ledger: Ledger, milestone: string, task: string): Task => ledger.milestones.find((m) => m.id === milestone)!.tasks.find((t) => t.id === task)!;

const waiting = (): Ledger => {
  const first = wait(base(), { milestone: "B2", task: "T9 store", what: "its output format", on: "B2:5 transcoder" }).ledger;
  const second = wait(first, { milestone: "B4", task: "T1 fills", what: "the store", on: "B2:5 transcoder" }).ledger;
  return wait(second, { milestone: "B4", task: "T1 fills", what: "the grid", on: "B2:6 grid" }).ledger;
};

describe("waiting on a task", () => {
  test("adds an entry that names the task, and leaves the free-text wait unset", () => {
    const waited = wait(base(), { milestone: "B2", task: "T9 store", what: "its output format", on: "B2:5 transcoder" });

    expect(taskOf(waited.ledger, "B2", "T9 store")).toStrictEqual({ id: "T9 store", track: "engine", status: "planned", also: [], waitsOn: [{ task: "B2:5 transcoder", what: "its output format" }] });
    expect(waited.message).toBe("B2 'T9 store': waits on B2:5 transcoder for its output format");
    expect(taskOf(base(), "B2", "T9 store").waitsOn).toBeUndefined();
  });

  test("keeps one entry for each task waited on, the latest word for it, beside a free-text wait", () => {
    const free = wait(waiting(), { milestone: "B4", task: "T1 fills", what: "the operator" }).ledger;

    const again = wait(free, { milestone: "B4", task: "T1 fills", what: "the store's reader", on: "B2:5 transcoder" });

    expect(taskOf(again.ledger, "B4", "T1 fills")).toMatchObject({ waits: "the operator", waitsOn: [{ task: "B2:6 grid", what: "the grid" }, { task: "B2:5 transcoder", what: "the store's reader" }] });
  });

  test("accepts a task that is not in the ledger yet, for the check to report", () => {
    const waited = wait(base(), { milestone: "B2", task: "T9 store", what: "the grid", on: "B7:not planned" });

    expect(taskOf(waited.ledger, "B2", "T9 store").waitsOn).toEqual([{ task: "B7:not planned", what: "the grid" }]);
  });

  test("refuses a name that is not MILESTONE:TASK, the task itself, and a task that has landed", () => {
    expect(() => wait(base(), { milestone: "B2", task: "T9 store", what: "x", on: "5 transcoder" })).toThrow("on takes MILESTONE:TASK, not '5 transcoder'");
    expect(() => wait(base(), { milestone: "B2", task: "T9 store", what: "x", on: "B2:" })).toThrow("on takes MILESTONE:TASK, not 'B2:'");
    expect(() => wait(base(), { milestone: "B2", task: "T9 store", what: "x", on: "B2:T9 store" })).toThrow("'T9 store' in B2 cannot wait on itself");
    expect(() => wait(base(), { milestone: "B2", task: "T9 store", what: "x", on: "B2:1 reader" })).toThrow("'1 reader' in B2 landed at abc1234, so there is nothing to wait for");
  });
});

describe("clearing a task's waits", () => {
  test("clears the free-text wait and every task it waits on, and says what they were", () => {
    const free = wait(waiting(), { milestone: "B4", task: "T1 fills", what: "the operator" }).ledger;

    const cleared = unwait(free, { milestone: "B4", task: "T1 fills" });

    expect(taskOf(cleared.ledger, "B4", "T1 fills")).toStrictEqual({ id: "T1 fills", track: "engine", status: "planned", also: [] });
    expect(cleared.message).toBe("B4 'T1 fills': no longer waits for the operator, B2:5 transcoder (the store), B2:6 grid (the grid)");
    expect(taskOf(cleared.ledger, "B2", "T9 store").waitsOn).toHaveLength(1);
  });

  test("clears a task that only waits on tasks", () => {
    const cleared = unwait(waiting(), { milestone: "B2", task: "T9 store" });

    expect(taskOf(cleared.ledger, "B2", "T9 store")).toStrictEqual({ id: "T9 store", track: "engine", status: "planned", also: [] });
    expect(cleared.message).toBe("B2 'T9 store': no longer waits for B2:5 transcoder (its output format)");
  });
});

describe("a landing and the tasks that waited on it", () => {
  test("removes every wait in the ledger that names the landed task, and says which tasks stopped waiting", async () => {
    const landed = await land(waiting(), { milestone: "B2", task: "5 transcoder", commit: "0123456789ab" }, resolve);

    expect(landed.message).toBe("B2 '5 transcoder': landed at 0123456; no longer waiting on it: B2 'T9 store', B4 'T1 fills'");
    expect(taskOf(landed.ledger, "B2", "T9 store")).toStrictEqual({ id: "T9 store", track: "engine", status: "planned", also: [] });
    expect(taskOf(landed.ledger, "B4", "T1 fills").waitsOn).toStrictEqual([{ task: "B2:6 grid", what: "the grid" }]);
  });

  test("leaves a free-text wait alone, even one that names the task", async () => {
    const free = wait(waiting(), { milestone: "B2", task: "T9 store", what: "B2:5 transcoder" }).ledger;

    const landed = await land(free, { milestone: "B2", task: "5 transcoder", commit: "0123456789ab" }, resolve);

    expect(taskOf(landed.ledger, "B2", "T9 store")).toStrictEqual({ id: "T9 store", track: "engine", status: "planned", also: [], waits: "B2:5 transcoder" });
  });

  test("a task that lands stops waiting itself, and a landing nothing waited on says only that it landed", async () => {
    const landed = await land(waiting(), { milestone: "B4", task: "T1 fills", commit: "0123456789ab" }, resolve);

    expect(taskOf(landed.ledger, "B4", "T1 fills")).toStrictEqual({ id: "T1 fills", track: "engine", status: "landed", commit: "0123456", also: [] });
    expect(landed.message).toBe("B4 'T1 fills': landed at 0123456");
    expect(taskOf(landed.ledger, "B2", "T9 store").waitsOn).toHaveLength(1);
  });
});

describe("a landing with deferred parts", () => {
  const deferred = [{ what: "the index", to: "B2:9 index" }, { what: "the docs" }];

  test("keeps the parts on the landed task, and a landing without any has no such key", async () => {
    const partly = await land(base(), { milestone: "B2", task: "5 transcoder", commit: "0123456789ab", deferred }, resolve);
    const whole = await land(base(), { milestone: "B2", task: "5 transcoder", commit: "0123456789ab" }, resolve);

    expect(taskOf(partly.ledger, "B2", "5 transcoder")).toStrictEqual({ id: "5 transcoder", track: "data", status: "landed", commit: "0123456", also: [], deferred });
    expect(partly.message).toBe("B2 '5 transcoder': landed at 0123456, in part: 2 deferred");
    expect(taskOf(whole.ledger, "B2", "5 transcoder")).toStrictEqual({ id: "5 transcoder", track: "data", status: "landed", commit: "0123456", also: [] });
  });

  test("recording the task again keeps its parts, replaces them with new ones, and drops them for an empty list", async () => {
    const partly = (await land(base(), { milestone: "B2", task: "5 transcoder", commit: "0123456789ab", deferred }, resolve)).ledger;

    const kept = await land(partly, { milestone: "B2", task: "5 transcoder", commit: "0123456789ab", also: ["fedcba9876"] }, resolve);
    const replaced = await land(partly, { milestone: "B2", task: "5 transcoder", commit: "0123456789ab", deferred: [{ what: "the docs", to: "B2:T9 store" }] }, resolve);
    const dropped = await land(partly, { milestone: "B2", task: "5 transcoder", commit: "0123456789ab", deferred: [] }, resolve);

    expect(taskOf(kept.ledger, "B2", "5 transcoder")).toMatchObject({ also: ["fedcba9"], deferred });
    expect(taskOf(replaced.ledger, "B2", "5 transcoder").deferred).toStrictEqual([{ what: "the docs", to: "B2:T9 store" }]);
    expect(taskOf(dropped.ledger, "B2", "5 transcoder")).toStrictEqual({ id: "5 transcoder", track: "data", status: "landed", commit: "0123456", also: [] });
    expect(dropped.message).toBe("B2 '5 transcoder': landed at 0123456");
  });

  test("refuses a part left to something that is not MILESTONE:TASK, before anything changes", async () => {
    await expect(land(base(), { milestone: "B2", task: "5 transcoder", commit: "0123456789ab", deferred: [{ what: "the index", to: "later" }] }, resolve))
      .rejects.toThrow("a deferred part's to takes MILESTONE:TASK, not 'later'");
  });
});
