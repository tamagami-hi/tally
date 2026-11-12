import { describe, expect, test } from "vitest";
import { rowsOf, summarize } from "../../src/status/summary.ts";
import type { Ledger, Milestone, Task } from "../../src/schema/ledger.ts";

const stages = [{ id: "B", name: "widen", weight: 1 }];

const onMain = async (): Promise<boolean> => true;

const landed = (id: string, track: string, more: Partial<Task> = {}): Task => ({ id, track, status: "landed", commit: "abc1234", also: [], ...more });
const planned = (id: string, track: string, more: Partial<Task> = {}): Task => ({ id, track, status: "planned", also: [], ...more });

const store = (tasks: Task[], more: Partial<Milestone> = {}): Milestone => ({ id: "B2", stage: "B", name: "store", track: "data+engine", weight: 1, tasks, ...more });

const ledgerOf = (...milestones: Milestone[]): Ledger => ({ schema: 1, baseline: "d0ff4a5", milestones, other: [] });

const notesOf = async (ledger: Ledger, milestone = "B2"): Promise<string[]> => (await summarize(ledger, stages, onMain)).rows.find((row) => row.id === milestone)!.notes;

describe("a task that landed in part", () => {
  const partly = landed("4 manifest", "data", { deferred: [{ what: "the index", to: "B2:5 transcoder" }, { what: "the docs", to: "B4:T1 fills" }] });
  const fills = (task: Task): Milestone => ({ id: "B4", stage: "B", name: "simulator", track: "engine", weight: 1, tasks: [task] });

  test("says so in its milestone's row, after the open tasks' notes, naming the parts still out", async () => {
    const ledger = ledgerOf(store([partly, planned("5 transcoder", "data")]), fills(planned("T1 fills", "engine")));

    expect(await notesOf(ledger)).toEqual(["data next: 5 transcoder", "4 manifest landed in part: the index, the docs"]);
  });

  test("names only the parts whose task has not landed, and stops once every one has", async () => {
    const half = ledgerOf(store([partly, landed("5 transcoder", "data")]), fills(planned("T1 fills", "engine")));
    const whole = ledgerOf(store([partly, landed("5 transcoder", "data")]), fills(landed("T1 fills", "engine")));

    expect(await notesOf(half)).toEqual(["4 manifest landed in part: the docs"]);
    expect(await notesOf(whole)).toEqual([]);
  });

  test("keeps saying so for a part left to no task, or to a task that is not in the ledger", async () => {
    const adrift = landed("4 manifest", "data", { deferred: [{ what: "the docs" }, { what: "the cache", to: "B9:nowhere" }] });

    expect(await notesOf(ledgerOf(store([adrift])))).toEqual(["4 manifest landed in part: the docs, the cache"]);
  });

  test("counts as landed all the same", async () => {
    const { rows } = await summarize(ledgerOf(store([partly, planned("5 transcoder", "data")])), stages, onMain);

    expect(rows[0]?.count).toEqual([1, 2]);
  });
});

describe("a milestone that owes a deliverable no task covers", () => {
  const delivers = [{ id: "manifest", what: "the manifest file" }, { id: "index", what: "the index" }, { id: "docs", what: "its page" }];

  test("says which, after its other notes, until tasks cover them all", async () => {
    const some = ledgerOf(store([planned("4 manifest", "data", { covers: ["manifest"] })], { delivers }));
    const all = ledgerOf(store([planned("4 manifest", "data", { covers: ["manifest", "index"] }), landed("9 docs", "data", { covers: ["docs"] })], { delivers }));

    expect(await notesOf(some)).toEqual(["data next: 4 manifest", "no task covers index, docs"]);
    expect(await notesOf(all)).toEqual(["data next: 4 manifest"]);
  });

  test("says so beside 'not started' when it has no tasks yet", async () => {
    expect(await notesOf(ledgerOf(store([], { delivers: [{ id: "page", what: "the page" }] })))).toEqual(["not started", "no task covers page"]);
  });
});

describe("a task that waits on another task", () => {
  test("is not its track's next task, and its note names what it waits on", async () => {
    const waiting = planned("T9 store", "engine", { waitsOn: [{ task: "B2:5 transcoder", what: "its output format" }] });
    const both = planned("T10 grid", "engine", { waits: "the operator", waitsOn: [{ task: "B2:5 transcoder", what: "" }] });

    expect(await notesOf(ledgerOf(store([planned("5 transcoder", "data"), waiting, both, planned("T11 last", "engine")])))).toEqual([
      "data next: 5 transcoder",
      "engine next: T11 last",
      "T9 store: waits for B2:5 transcoder (its output format)",
      "T10 grid: waits for the operator, B2:5 transcoder",
    ]);
  });
});

describe("one track's slice of rows that owe something", () => {
  test("keeps the track's own landed-in-part notes and the milestone's uncovered deliverables", async () => {
    const tasks = [
      landed("4 manifest", "data", { deferred: [{ what: "the index", to: "B4:T1 fills" }] }),
      landed("T8 reader", "engine", { deferred: [{ what: "the cache" }] }),
      planned("T9 store", "engine"),
    ];
    const ledger = ledgerOf(store(tasks, { delivers: [{ id: "page", what: "the page" }] }), { id: "B4", stage: "B", name: "simulator", track: "engine", weight: 1, tasks: [planned("T1 fills", "engine")] });
    const { rows } = await summarize(ledger, stages, onMain);

    expect(rowsOf(rows, "data")[0]?.notes).toEqual(["4 manifest landed in part: the index", "no task covers page"]);
    expect(rowsOf(rows, "engine")[0]?.notes).toEqual(["engine next: T9 store", "T8 reader landed in part: the cache", "no task covers page"]);
  });
});
