// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Board } from "../src/components/Board.tsx";
import { Hero } from "../src/components/Header.tsx";
import { Shell } from "../src/Shell.tsx";
import type { MilestoneRow, StatusData } from "../src/types.ts";
import { snapshot } from "./fixture.ts";

afterEach(cleanup);

const row = (id: string, stage: string, finished: boolean): MilestoneRow => ({ id, stage, name: `${id} work`, track: "alpha", weight: 1, share: finished ? 1 : 0.5, count: [finished ? 2 : 1, 2], notes: [], finished, tasks: [] });

const A_CLOSED = { id: "A", name: "first", state: "closed" as const, closedAt: "2026-11-14T12:00:00.000Z" };
const B_OPEN = { id: "B", name: "second", state: "open" as const };
const C_OPEN = { id: "C", name: "third", state: "open" as const };

const statusOf = (stages: StatusData["stages"], rows: MilestoneRow[]): StatusData => ({ ...snapshot.status, stages, rows, stagePct: { A: 1, B: 0.5, C: 1 } });

function drawn(status: StatusData) {
  const opened: string[] = [];
  render(<Board status={status} onOpenDone={() => opened.push("done")} />);
  return opened;
}

describe("the board of open work", () => {
  test("draws a phase's unfinished milestones only, and a button that says how many finished ones are in Done", () => {
    const opened = drawn(statusOf([B_OPEN], [row("B1", "B", true), row("B2", "B", false), row("B3", "B", true)]));

    expect(screen.getByText("B2")).toBeInTheDocument();
    expect(screen.queryByText("B1")).toBeNull();
    expect(screen.queryByText("B3")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "2 finished milestones are in Done" }));
    expect(opened).toEqual(["done"]);
  });

  test("says of an open phase whose milestones are all finished that an operator session closes it", () => {
    drawn(statusOf([C_OPEN], [row("C1", "C", true)]));

    expect(screen.getByText("Every milestone is finished. An operator session closes the phase with phase_close.")).toBeInTheDocument();
    expect(screen.queryByText("C1")).toBeNull();
    expect(screen.getByRole("button", { name: "1 finished milestone is in Done" })).toBeInTheDocument();
  });

  test("keeps a closed phase that has open work again, and says so", () => {
    drawn(statusOf([A_CLOSED, B_OPEN], [row("A1", "A", false), row("B2", "B", false)]));

    expect(screen.getByText("closed 2026-11-14, and it has open work again")).toBeInTheDocument();
    expect(screen.getByText("A1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /closed phase/ })).toBeNull();
  });

  test("leaves a closed phase off, and says after the phases how many closed ones are in Done", () => {
    const opened = drawn(statusOf([A_CLOSED, B_OPEN], [row("A1", "A", true), row("B2", "B", false)]));

    expect(screen.queryByText("A1")).toBeNull();
    expect(screen.queryByRole("heading", { name: /Stage A/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 closed phase is in Done" }));
    expect(opened).toEqual(["done"]);
  });

  test("says so when nothing is open, and points to Done", () => {
    const opened = drawn(statusOf([A_CLOSED], [row("A1", "A", true)]));

    expect(screen.getByText(/Nothing is open\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Done" }));
    expect(opened).toEqual(["done"]);
  });

  test("says nothing of Done where the repository has no phase at all", () => {
    drawn(statusOf([], []));

    expect(screen.queryByText(/Nothing is open\./)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("the hero", () => {
  test("draws a line for each phase on the board, and one quiet line for the closed rest", () => {
    render(<Hero status={statusOf([A_CLOSED, { ...A_CLOSED, id: "Z" }, B_OPEN], [row("A1", "A", true), row("B2", "B", false)])} />);
    const hero = screen.getByLabelText("Overall progress");

    expect(within(hero).getByText("Stage B")).toBeInTheDocument();
    expect(within(hero).queryByText("Stage A")).toBeNull();
    expect(within(hero).getByText("2 phases closed")).toBeInTheDocument();
    expect(within(hero).getByLabelText("Overall 52%")).toBeInTheDocument();
  });

  test("draws no quiet line when no phase is off the board", () => {
    render(<Hero status={statusOf([B_OPEN], [row("B2", "B", false)])} />);

    expect(screen.queryByText(/closed$/)).toBeNull();
  });
});

describe("the board panel's detail", () => {
  test.each(["landscape", "portrait"] as const)("says how many milestones are open and finished in %s", (layout) => {
    render(<Shell snapshot={snapshot} error={null} live="connected" layout={layout} scheme="light" onToggleScheme={() => undefined} onRetry={() => undefined} />);

    expect(screen.getByText("3 open · 1 finished")).toBeInTheDocument();
  });
});
