import { describe, expect, test } from "vitest";
import { closedLine, countsDetail, finishedLine, openBoard } from "../src/open.ts";
import type { MilestoneRow, StatusData } from "../src/types.ts";
import { snapshot } from "./fixture.ts";

const row = (id: string, stage: string, finished: boolean): MilestoneRow => ({ id, stage, name: `${id} work`, track: "alpha", weight: 1, share: finished ? 1 : 0.5, count: [finished ? 2 : 1, 2], notes: [], finished, tasks: [] });

const statusOf = (stages: StatusData["stages"], rows: MilestoneRow[]): StatusData => ({ ...snapshot.status, stages, rows, stagePct: { A: 1, B: 0.5, C: 1 } });

const A_CLOSED = { id: "A", name: "first", state: "closed" as const, closedAt: "2026-11-14T12:00:00.000Z" };
const B_OPEN = { id: "B", name: "second", state: "open" as const };
const C_OPEN = { id: "C", name: "third", state: "open" as const };

describe("which phases the board shows", () => {
  test("an open phase, with its unfinished milestones only and how many are finished", () => {
    const board = openBoard(statusOf([B_OPEN], [row("B1", "B", true), row("B2", "B", false), row("B3", "B", true)]));

    expect(board.stages.map((stage) => [stage.id, stage.rows.map((one) => one.id), stage.finished])).toEqual([["B", ["B2"], 2]]);
    expect(board.stages[0]).toMatchObject({ share: 0.5, allFinished: false, reopened: false });
  });

  test("a closed phase only when a milestone of it is unfinished again, marked as such", () => {
    const off = openBoard(statusOf([A_CLOSED, B_OPEN], [row("A1", "A", true), row("B2", "B", false)]));
    const back = openBoard(statusOf([A_CLOSED, B_OPEN], [row("A1", "A", false), row("B2", "B", false)]));

    expect(off.stages.map((stage) => stage.id)).toEqual(["B"]);
    expect(off.closedOff).toBe(1);
    expect(back.stages.map((stage) => [stage.id, stage.reopened])).toEqual([["A", true], ["B", false]]);
    expect(back.closedOff).toBe(0);
  });

  test("an open phase whose milestones are all finished, with no milestone and the mark that it is all finished", () => {
    const board = openBoard(statusOf([C_OPEN], [row("C1", "C", true), row("C2", "C", true)]));

    expect(board.stages).toMatchObject([{ id: "C", rows: [], finished: 2, allFinished: true }]);
  });

  test("an open phase with no milestone yet, as it is", () => {
    expect(openBoard(statusOf([B_OPEN], [])).stages).toMatchObject([{ id: "B", rows: [], finished: 0, allFinished: false }]);
  });

  test("nothing when every phase is closed and finished, and counts the closed ones", () => {
    const board = openBoard(statusOf([A_CLOSED, { ...A_CLOSED, id: "Z" }], [row("A1", "A", true)]));

    expect(board.stages).toEqual([]);
    expect(board.closedOff).toBe(2);
  });
});

describe("the board's words", () => {
  test("say how many finished milestones and closed phases are in Done", () => {
    expect(finishedLine(1)).toBe("1 finished milestone is in Done");
    expect(finishedLine(9)).toBe("9 finished milestones are in Done");
    expect(closedLine(1)).toBe("1 closed phase is in Done");
    expect(closedLine(2)).toBe("2 closed phases are in Done");
  });

  test("the panel's detail says how many milestones are open and how many finished", () => {
    expect(countsDetail(statusOf([B_OPEN], [row("B1", "B", true), row("B2", "B", false), row("B3", "B", false)]))).toBe("2 open · 1 finished");
  });
});
