import { describe, expect, test } from "vitest";
import { doneWork } from "../../src/done/work.ts";
import { collect } from "../../src/status/collect.ts";
import { Records } from "../../src/store/records.ts";
import { CLOSED_G, CLOSED_H, CSV_COMMITTED, READER_COMMITTED, WRITER_RECORDED, finishedWork } from "../support/done.ts";

async function answered() {
  const made = await finishedWork();
  const status = await collect(made.repo, await new Records(made.repo).readLedger());
  return { ...made, status, done: await doneWork(made.repo, status) };
}

describe("the Done answer", () => {
  test("counts the closed phases, the finished milestones and the landed tasks", async () => {
    const { done } = await answered();

    expect(done.counts).toEqual({ phasesClosed: 2, milestonesFinished: 2, tasksLanded: 5 });
  });

  test("lists the closed phases first, latest close first, then the open ones with something done in the board's order", async () => {
    const { done } = await answered();

    expect(done.phases.map((phase) => [phase.id, phase.state])).toEqual([["H", "closed"], ["G", "closed"], ["B", "open"]]);
  });

  test("gives a closed phase its closing fields, and an open one none", async () => {
    const { done } = await answered();
    const [h, g, b] = done.phases;

    expect(g).toMatchObject({ name: "G phase", goal: "Ship exports.", closedAt: CLOSED_G, closedBy: { track: "main", agent: "operator" }, summary: "The exports shipped.", commit: "c0ffee1", share: 1, milestones: { finished: 1, total: 1 }, tasks: { landed: 1, total: 1 } });
    expect(h).toMatchObject({ closedAt: CLOSED_H, closedBy: { agent: "lead" }, rows: [], milestones: { finished: 0, total: 0 } });
    expect(b).not.toHaveProperty("closedAt");
    expect(b).not.toHaveProperty("summary");
    expect(b).toMatchObject({ state: "open", milestones: { finished: 1, total: 4 }, tasks: { landed: 4, total: 6 } });
  });

  test("lists a milestone that is finished or has a landed task, with its landed tasks only", async () => {
    const { done } = await answered();
    const b = done.phases[2]!;

    expect(b.rows.map((row) => [row.id, row.finished, row.count, row.tasks.map((task) => task.id)])).toEqual([
      ["B2", false, [2, 3], ["2 writer", "1 reader"]],
      ["B4", false, [0, 2], ["9 lost", "8 gone"]],
      ["B5", true, null, []],
    ]);
    expect(b.rows[2]).toMatchObject({ built: "aaa1111..bbb2222", name: "B5 work", track: "data" });
  });

  test("dates a task by its recorded landing, else by its commit, and leaves the date out when the commit is not found", async () => {
    const { done, commits } = await answered();
    const [writer, reader] = done.phases[2]!.rows[0]!.tasks;
    const lost = done.phases[2]!.rows[1]!.tasks[0]!;

    expect(writer).toMatchObject({ id: "2 writer", commit: commits["writer"], at: WRITER_RECORDED, dated: "recorded" });
    expect(reader).toMatchObject({ id: "1 reader", track: "data", commit: commits["reader"], also: [], at: READER_COMMITTED, dated: "commit" });
    expect(lost).not.toHaveProperty("at");
    expect(lost).not.toHaveProperty("dated");
  });

  test("gives each deferred part its state, and why when it is parked", async () => {
    const { done } = await answered();
    const csv = done.phases[1]!.rows[0]!.tasks[0]!;
    const reader = done.phases[2]!.rows[0]!.tasks[1]!;

    expect(csv).toMatchObject({ at: CSV_COMMITTED, dated: "commit" });
    expect(csv.deferred).toEqual([
      { what: "the docs", to: "B2:3 index", state: "waiting" },
      { what: "the cache", why: "not needed yet", state: "parked" },
      { what: "the index", to: "B2:2 writer", state: "done" },
    ]);
    expect(reader.deferred).toEqual([{ what: "the manual", state: "unplaced" }]);
    expect(done.phases[2]!.rows[0]!.tasks[0]).not.toHaveProperty("deferred");
  });

  test("keeps a closed phase listed when a milestone of it is unfinished again, and says so by the row", async () => {
    const { repo, status } = await answered();
    const reopened = { ...status, rows: status.rows.map((row) => (row.id === "G1" ? { ...row, finished: false } : row)) };

    const done = await doneWork(repo, reopened);

    expect(done.phases[1]).toMatchObject({ id: "G", state: "closed", milestones: { finished: 0, total: 1 }, rows: [{ id: "G1", finished: false }] });
  });
});
