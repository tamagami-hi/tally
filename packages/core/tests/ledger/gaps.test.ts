import { describe, expect, test } from "vitest";
import { findGaps, gapsOf, uncovered, unfinished } from "../../src/ledger/gaps.ts";
import type { Ledger } from "../../src/schema/ledger.ts";

const old: Ledger = {
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [{ id: "B2", stage: "B", name: "store", track: "data", weight: 1, tasks: [
    { id: "1", track: "data", status: "landed", commit: "abc1234", also: [] },
    { id: "2", track: "data", status: "planned", also: [], waits: "B1" },
  ] }],
  other: [],
};

const ledger: Ledger = {
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [
    { id: "B2", stage: "B", name: "store", track: "data", weight: 1, delivers: [{ id: "manifest", what: "the manifest file" }, { id: "index", what: "the index" }], tasks: [
      { id: "1 reader", track: "data", status: "landed", commit: "abc1234", also: [] },
      { id: "4 manifest", track: "data", status: "landed", commit: "def5678", also: [], covers: ["manifest"], deferred: [
        { what: "the checksum", to: "B2:5 transcoder" },
        { what: "the docs" },
        { what: "the cache", to: "B2:nowhere" },
        { what: "the old reader", to: "B2:1 reader" },
      ] },
      { id: "5 transcoder", track: "data", status: "planned", also: [] },
    ] },
    { id: "B4", stage: "B", name: "simulator", track: "engine", weight: 1, delivers: [{ id: "fills", what: "the fill model" }], tasks: [
      { id: "T1 fills", track: "engine", status: "planned", also: [], waitsOn: [{ task: "B2:5 transcoder", what: "the store" }, { task: "B2:6 grid", what: "the grid" }, { note: "n-1", what: "an answer" }] },
      { id: "T2 data side", track: "data", status: "planned", also: [], waitsOn: [{ task: "B9:x", what: "x" }] },
    ] },
    { id: "B5", stage: "B", name: "builder", track: "product", weight: 1, delivers: [{ id: "page", what: "the page" }], tasks: [] },
    { id: "B6", stage: "B", name: "rules", track: "all", weight: 1, delivers: [{ id: "rules", what: "the rules page" }], tasks: [] },
  ],
  other: [],
};

const GAPS = {
  index: "B2 delivers 'index' (the index), and no task covers it: plan a task that covers it with task_plan",
  docs: "B2 '4 manifest' landed without 'the docs' and names no task to finish it: record it again with task_land, the part left to a task",
  cache: "B2 '4 manifest' left 'the cache' to B2:nowhere, which is not a task in the ledger: plan it with task_plan",
  fills: "B4 delivers 'fills' (the fill model), and no task covers it: plan a task that covers it with task_plan",
  grid: "B4 'T1 fills' waits on B2:6 grid, which is not a task in the ledger: plan it with task_plan, or clear the wait with task_unwait",
  nowhere: "B4 'T2 data side' waits on B9:x, which is not a task in the ledger: plan it with task_plan, or clear the wait with task_unwait",
  page: "B5 delivers 'page' (the page), and no task covers it: plan a task that covers it with task_plan",
  rules: "B6 delivers 'rules' (the rules page), and no task covers it: plan a task that covers it with task_plan",
};

describe("the gaps a ledger shows", () => {
  test("are none for a ledger written before the fields existed", () => {
    expect(findGaps(old)).toEqual([]);
    expect(uncovered(old.milestones[0]!)).toEqual([]);
    expect(unfinished(old, old.milestones[0]!.tasks[0]!)).toEqual([]);
  });

  test("are a deliverable no task covers, a wait on a task that is not there, and a deferred part with no task that is there to finish it", () => {
    expect(findGaps(ledger).map((gap) => gap.text)).toEqual([GAPS.index, GAPS.docs, GAPS.cache, GAPS.fills, GAPS.grid, GAPS.nowhere, GAPS.page, GAPS.rules]);
  });

  test("leave out a wait on a planned task, a wait on a note, and a part left to a task that is planned", () => {
    const texts = findGaps(ledger).map((gap) => gap.text).join("\n");

    expect(texts).not.toContain("B2:5 transcoder");
    expect(texts).not.toContain("n-1");
    expect(texts).not.toContain("the checksum");
  });

  test("name the milestone, and the task and its track when the gap is a task's", () => {
    const gaps = findGaps(ledger);

    expect(gaps[0]).toEqual({ milestone: "B2", text: GAPS.index });
    expect(gaps[1]).toEqual({ milestone: "B2", task: "4 manifest", track: "data", text: GAPS.docs });
    expect(gaps[4]).toEqual({ milestone: "B4", task: "T1 fills", track: "engine", text: GAPS.grid });
  });
});

describe("one track's gaps", () => {
  test("are its own tasks' gaps and the uncovered deliverables of the milestones it works in or everyone owns", () => {
    expect(gapsOf(ledger, "data").map((gap) => gap.text)).toEqual([GAPS.index, GAPS.docs, GAPS.cache, GAPS.fills, GAPS.nowhere, GAPS.rules]);
    expect(gapsOf(ledger, "engine").map((gap) => gap.text)).toEqual([GAPS.fills, GAPS.grid, GAPS.rules]);
    expect(gapsOf(ledger, "product").map((gap) => gap.text)).toEqual([GAPS.page, GAPS.rules]);
  });
});

describe("what a milestone still owes and what a landed task left", () => {
  test("a milestone's uncovered deliverables are the ones no task of it covers", () => {
    expect(uncovered(ledger.milestones[0]!)).toEqual([{ id: "index", what: "the index" }]);
  });

  test("a landed task's unfinished parts are the ones whose task has not landed, is not there, or was never named", () => {
    const task = ledger.milestones[0]!.tasks[1]!;

    expect(unfinished(ledger, task).map((part) => part.what)).toEqual(["the checksum", "the docs", "the cache"]);
    expect(unfinished(ledger, { ...task, status: "planned", commit: undefined })).toEqual([]);
  });
});
