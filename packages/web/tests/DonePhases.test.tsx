// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { DonePhases } from "../src/components/DonePhases.tsx";
import { work } from "./done-fixture.ts";

afterEach(cleanup);

const block = (id: string): HTMLElement => screen.getByText(`Stage ${id}`).closest("details") as HTMLElement;

describe("the phases and tasks in Done", () => {
  test("open with a line of counts, then one folded block per phase, the first one open", () => {
    render(<DonePhases work={work} />);

    expect(screen.getByText("1 phase closed · 2 milestones finished · 4 tasks landed")).toBeInTheDocument();
    expect(block("H")).toHaveAttribute("open");
    expect(block("W")).not.toHaveAttribute("open");
  });

  test("head a closed phase with its date, its summary, who closed it and where main stood", () => {
    render(<DonePhases work={work} />);
    const closed = within(block("H"));

    expect(closed.getByText("the reader")).toBeInTheDocument();
    expect(closed.getByText("closed 2026-11-14")).toBeInTheDocument();
    expect(closed.getByText("The reader shipped.")).toBeInTheDocument();
    expect(closed.getByText("closed by operator (main) at c0ffee1")).toBeInTheDocument();
  });

  test("head an open phase with its share", () => {
    render(<DonePhases work={work} />);

    expect(within(block("W")).getByText("open, 84%")).toBeInTheDocument();
  });

  test("mark a finished milestone with a tick, and one in progress with how many of its tasks landed", () => {
    render(<DonePhases work={work} />);

    expect(within(block("H")).getByLabelText("finished")).toBeInTheDocument();
    expect(within(block("W")).getByText("3 of 5 landed")).toBeInTheDocument();
    expect(within(block("W")).getByText("built")).toBeInTheDocument();
  });

  test("show a task's id, track, commit and how many more, and its date, saying where the date came from", () => {
    render(<DonePhases work={work} />);

    expect(screen.getByText("1 csv")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("+2 more")).toBeInTheDocument();
    expect(screen.getByText("2026-11-13 16:45")).toHaveAttribute("title", "the date of its commit; the landing recorded none");
    expect(screen.getByText("2026-11-12 09:00")).toHaveAttribute("title", "recorded when it landed");
    expect(screen.getByText("no date")).toHaveAttribute("title", "its commit was not found on main");
  });

  test("list a task's deferred parts with their state", () => {
    render(<DonePhases work={work} />);

    expect(screen.getByText("the docs: left to B2:3 index, not landed yet")).toHaveClass("part", "waiting");
    expect(screen.getByText("the cache: parked, not needed yet")).toHaveClass("part", "parked");
    expect(screen.getByText("the index: done in B2:2 writer")).toHaveClass("part", "done");
    expect(screen.getByText("the manual: left to no task")).toHaveClass("part", "unplaced");
  });

  test("say so when nothing is finished yet", () => {
    render(<DonePhases work={{ counts: { phasesClosed: 0, milestonesFinished: 0, tasksLanded: 0 }, phases: [] }} />);

    expect(screen.getByText(/Nothing is finished yet\./)).toBeInTheDocument();
  });

  test("mark a task whose landing checked its tip only", () => {
    const phases = work.phases.map((phase) => ({ ...phase, rows: phase.rows.map((row) => ({ ...row, tasks: row.tasks.map((task) => (task.id === "1 csv" ? { ...task, checked: "tip" as const } : task)) })) }));
    render(<DonePhases work={{ ...work, phases }} />);

    expect(within(block("H")).getByText("tip only")).toHaveAttribute("title", "its landing checked the last commit alone, as it was asked to");
  });

  test("mark a task built under an open question's meanwhile, naming the questions", () => {
    const phases = work.phases.map((phase) => ({ ...phase, rows: phase.rows.map((row) => ({ ...row, tasks: row.tasks.map((task) => (task.id === "1 csv" ? { ...task, under: ["Q-4", "Q-7"] } : task)) })) }));
    render(<DonePhases work={{ ...work, phases }} />);

    expect(within(block("H")).getByText("under Q-4, Q-7")).toHaveAttribute("title", "built on these questions' meanwhile: check it against their answers");
  });
});
