import { describe, expect, test } from "vitest";
import { ago, rowsOf, summarize } from "../../src/status/summary.ts";
import type { Ledger } from "../../src/schema/ledger.ts";

const stages = [
  { id: "A", name: "the thin slice", weight: 32 },
  { id: "B", name: "widen every part", weight: 52 },
  { id: "C", name: "waits on the operator", weight: 16 },
];

const ledger: Ledger = {
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [
    { id: "A", stage: "A", name: "thin slice", track: "all", weight: 100, built: "073f80a..19a7c3b", tasks: [] },
    { id: "B4", stage: "B", name: "simulator", track: "data+engine", weight: 14, tasks: [
      { id: "T1", track: "engine", status: "landed", commit: "2827efa", also: [] },
      { id: "T2", track: "engine", status: "landed", commit: "gone000", also: [] },
      { id: "T8", track: "engine", status: "planned", also: [] },
      { id: "T9", track: "engine", status: "planned", also: [], waits: "B2" },
      { id: "data 1", track: "data", status: "planned", also: [] },
    ] },
    { id: "B5", stage: "B", name: "builder", track: "engine", weight: 14, tasks: [] },
    { id: "C1", stage: "C", name: "candles", track: "-", weight: 34, tasks: [], waits: "the recorder's candle files" },
  ],
  other: [],
};

const onMain = async (commit: string): Promise<boolean> => commit !== "gone000";

describe("summarizing the ledger", () => {
  test("counts a landed task only when its commit is on main, and reports the one that is not", async () => {
    const summary = await summarize(ledger, stages, onMain);
    const b4 = summary.rows.find((r) => r.id === "B4")!;
    expect(b4.count).toEqual([1, 5]);
    expect(b4.share).toBeCloseTo(0.2);
    expect(summary.problems).toEqual(["B4 'T2': gone000 is not on main"]);
  });

  test("notes each track's next task and every wait", async () => {
    const summary = await summarize(ledger, stages, onMain);
    const b4 = summary.rows.find((r) => r.id === "B4")!;
    expect(b4.notes).toEqual(["engine next: T8", "data next: data 1", "T9: waits for B2"]);
    expect(summary.rows.find((r) => r.id === "A")!.notes).toEqual(["built"]);
    expect(summary.rows.find((r) => r.id === "B5")!.notes).toEqual(["not started"]);
    expect(summary.rows.find((r) => r.id === "C1")!.notes).toEqual(["waits for the recorder's candle files"]);
  });

  test("weighs milestones into stages and stages into the whole", async () => {
    const summary = await summarize(ledger, stages, onMain);
    expect(summary.stagePct["A"]).toBe(1);
    expect(summary.stagePct["B"]).toBeCloseTo(0.1);
    expect(summary.stagePct["C"]).toBe(0);
    expect(summary.overall).toBeCloseTo((32 * 1 + 52 * 0.1 + 16 * 0) / 100);
  });
});

describe("one track's slice of the rows", () => {
  test("keeps only that track's rows, tasks and notes, and the milestone's whole progress", async () => {
    const { rows } = await summarize(ledger, stages, onMain);

    const slice = rowsOf(rows, "data");

    expect(slice.map((r) => r.id)).toEqual(["B4"]);
    expect(slice[0]?.tasks.map((t) => t.id)).toEqual(["data 1"]);
    expect(slice[0]?.notes).toEqual(["data next: data 1"]);
    expect(slice[0]?.count).toEqual([1, 5]);
  });

  test("leaves a row with no tasks its own note, and shows no row of everyone's that holds nothing of the track's", async () => {
    const { rows } = await summarize(ledger, stages, onMain);

    const slice = rowsOf(rows, "engine");

    expect(slice.map((r) => r.id)).toEqual(["B4", "B5"]);
    expect(slice[0]?.notes).toEqual(["engine next: T8", "T9: waits for B2"]);
    expect(slice[1]?.notes).toEqual(["not started"]);
  });

  test("finds a row by a task of the track even when the milestone does not name it", async () => {
    const mixed: Ledger = { ...ledger, milestones: [{ id: "B7", stage: "B", name: "analytics", track: "engine", weight: 1, tasks: [{ id: "1", track: "engine", status: "planned", also: [] }, { id: "2", track: "data", status: "planned", also: [] }] }] };
    const { rows } = await summarize(mixed, stages, onMain);

    expect(rowsOf(rows, "data").map((r) => r.tasks.map((t) => t.id))).toEqual([["2"]]);
  });
});

describe("ago", () => {
  test("speaks in minutes, hours and days", () => {
    const now = 1_000_000;
    expect(ago(now - 10, now)).toBe("just now");
    expect(ago(now - 5 * 60, now)).toBe("5 min ago");
    expect(ago(now - (2 * 60 + 3) * 60, now)).toBe("2 h 03 min ago");
    expect(ago(now - 3 * 86400, now)).toBe("3 days ago");
  });
});
