import { describe, expect, test } from "vitest";
import { addTask, findMilestone, keepCloseLast, knownCommits } from "../../src/ledger/items.ts";
import type { Ledger, Task } from "../../src/schema/ledger.ts";

const planned = (id: string, track = "data"): Task => ({ id, track, status: "planned", also: [] });
const landed = (id: string, commit: string, track = "data"): Task => ({ id, track, status: "landed", commit, also: [] });

describe("keeping an unfinished close last", () => {
  test("moves every unfinished close after the other tasks, in order", () => {
    const tasks = [planned("B4 close", "engine"), landed("done", "abc1234"), planned("product replay", "product")];
    expect(keepCloseLast(tasks).map((t) => t.id)).toEqual(["done", "product replay", "B4 close"]);
  });

  test("leaves a finished close where it is", () => {
    const tasks = [landed("data part close", "37666b0"), planned("next")];
    expect(keepCloseLast(tasks).map((t) => t.id)).toEqual(["data part close", "next"]);
  });

  test("a new task goes before the unfinished close, and a new close goes last", () => {
    const tasks = [landed("existing task", "abc1234"), planned("B2 data close")];
    const added = addTask(tasks, planned("product transcode job", "product"));
    expect(added.map((t) => t.id)).toEqual(["existing task", "product transcode job", "B2 data close"]);
    const close = addTask(added, planned("B9 close", "product"));
    expect(close.map((t) => t.id)).toEqual(["existing task", "product transcode job", "B2 data close", "B9 close"]);
  });

  test("does not change the tasks it was given", () => {
    const tasks = [planned("B2 data close"), landed("existing", "abc1234")];
    const copy = structuredClone(tasks);
    keepCloseLast(tasks);
    addTask(tasks, planned("more"));
    expect(tasks).toEqual(copy);
  });
});

describe("finding and knowing", () => {
  const ledger: Ledger = {
    schema: 1,
    baseline: "d0ff4a5",
    milestones: [{ id: "B2", stage: "B", name: "replay store", track: "data", weight: 11, tasks: [landed("1", "e66f4641"), { ...planned("2"), also: ["abcdef0123"] }] }],
    other: [{ commit: "bf8e993", note: "rule: the progress ledger" }],
  };

  test("names the known milestones when one is missing", () => {
    expect(() => findMilestone(ledger, "B9")).toThrow("no milestone 'B9'; known: B2");
    expect(findMilestone(ledger, "B2").name).toBe("replay store");
  });

  test("knows every recorded commit by its first seven characters", () => {
    expect([...knownCommits(ledger)].sort()).toEqual(["abcdef0", "bf8e993", "e66f464"]);
  });
});
