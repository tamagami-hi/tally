import { describe, expect, test } from "vitest";
import { rowsOf, summarize } from "../../src/status/summary.ts";
import type { Needing } from "../../src/ledger/review-gaps.ts";
import type { Ledger, Milestone, Task } from "../../src/schema/ledger.ts";

const stages = [{ id: "B", name: "widen", weight: 1 }];

const everywhere = async (): Promise<boolean> => true;

const landed = (id: string, more: Partial<Task> = {}): Task => ({ id, track: "data", status: "landed", commit: "abc1234", also: [], ...more });
const planned = (id: string, more: Partial<Task> = {}): Task => ({ id, track: "data", status: "planned", also: [], ...more });

const milestone = (id: string, tasks: Task[], more: Partial<Milestone> = {}): Milestone => ({ id, stage: "B", name: `${id} work`, track: "data", weight: 1, tasks, ...more });

const ledgerOf = (...milestones: Milestone[]): Ledger => ({ schema: 1, baseline: "d0ff4a5", milestones, other: [] });

async function finished(ledger: Ledger, id = "B2", onMain = everywhere, needing: readonly Needing[] = []): Promise<boolean | undefined> {
  return (await summarize(ledger, stages, onMain, needing)).rows.find((row) => row.id === id)?.finished;
}

describe("a milestone that is finished", () => {
  test("is one marked built", async () => {
    expect(await finished(ledgerOf(milestone("B2", [], { built: "aaa1111..bbb2222" })))).toBe(true);
  });

  test("is one whose every task landed on main, with no gap", async () => {
    expect(await finished(ledgerOf(milestone("B2", [landed("1 reader"), landed("2 writer")])))).toBe(true);
  });

  test("is one whose landed task left a part to a task that is planned elsewhere", async () => {
    const left = landed("1 reader", { deferred: [{ what: "the index", to: "B3:7 index" }] });

    expect(await finished(ledgerOf(milestone("B2", [left]), milestone("B3", [planned("7 index")])))).toBe(true);
  });

  test("is one whose landed task parked a part", async () => {
    const parked = landed("1 reader", { deferred: [{ what: "the cache", parked: { why: "not needed yet" } }] });

    expect(await finished(ledgerOf(milestone("B2", [parked])))).toBe(true);
  });
});

describe("a milestone that is not finished", () => {
  test("has a task that has not landed", async () => {
    expect(await finished(ledgerOf(milestone("B2", [landed("1 reader"), planned("2 writer")])))).toBe(false);
  });

  test("has a landed task that left a part to no task", async () => {
    const adrift = landed("1 reader", { deferred: [{ what: "the docs" }] });

    expect(await finished(ledgerOf(milestone("B2", [adrift])))).toBe(false);
  });

  test("has a landed task that left a part to a task the ledger does not hold", async () => {
    const nowhere = landed("1 reader", { deferred: [{ what: "the docs", to: "B9:gone" }] });

    expect(await finished(ledgerOf(milestone("B2", [nowhere])))).toBe(false);
  });

  test("owes a deliverable no task covers", async () => {
    const delivers = [{ id: "reader", what: "the reader" }, { id: "page", what: "its page" }];

    expect(await finished(ledgerOf(milestone("B2", [landed("1 reader", { covers: ["reader"] })], { delivers })))).toBe(false);
  });

  test("has a landed task that still needs a review", async () => {
    const needing: Needing[] = [{ milestone: "B2", task: "1 reader", track: "data", state: "none" }];

    expect(await finished(ledgerOf(milestone("B2", [landed("1 reader")])), "B2", everywhere, needing)).toBe(false);
  });

  test("has a landed task whose commit is not on main", async () => {
    const offMain = async (commit: string): Promise<boolean> => commit !== "abc1234";

    expect(await finished(ledgerOf(milestone("B2", [landed("1 reader")])), "B2", offMain)).toBe(false);
  });

  test("has no task and is not marked built", async () => {
    expect(await finished(ledgerOf(milestone("B2", [])))).toBe(false);
  });

  test("is not held back by a gap of another milestone", async () => {
    const other = milestone("B3", [landed("9 other", { deferred: [{ what: "the docs" }] })]);

    expect(await finished(ledgerOf(milestone("B2", [landed("1 reader")]), other))).toBe(true);
    expect(await finished(ledgerOf(milestone("B2", [landed("1 reader")]), other), "B3")).toBe(false);
  });
});

describe("one track's slice", () => {
  test("keeps the milestone's own finished, as it keeps its own share", async () => {
    const ledger = ledgerOf(milestone("B2", [landed("1 reader"), landed("2 engine", { track: "engine" })], { track: "data+engine" }), milestone("B3", [planned("3 later")]));
    const { rows } = await summarize(ledger, stages, everywhere);

    expect(rowsOf(rows, "engine").map((row) => [row.id, row.finished])).toEqual([["B2", true]]);
    expect(rowsOf(rows, "data").map((row) => [row.id, row.finished])).toEqual([["B2", true], ["B3", false]]);
  });
});
