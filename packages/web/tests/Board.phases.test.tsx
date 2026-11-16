// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Board } from "../src/components/Board.tsx";
import { snapshot } from "./fixture.ts";

afterEach(cleanup);

const stages = [
  { id: "A", name: "the first slice", goal: "Ship the first slice.", state: "closed" as const, closedAt: "2026-11-14T12:00:00.000Z" },
  { id: "B", name: "widening", goal: "Widen it to two formats.", state: "open" as const },
  { id: "C", name: "later", state: "open" as const },
];

const reopened = { ...snapshot.status, stages, rows: snapshot.status.rows.map((row) => (row.stage === "A" ? { ...row, finished: false } : row)) };

describe("a stage on the board", () => {
  test("shows the phase's goal, and when a closed phase with open work again closed", () => {
    render(<Board status={reopened} />);

    expect(screen.getByText("Ship the first slice.")).toBeInTheDocument();
    expect(screen.getByText("Widen it to two formats.")).toBeInTheDocument();
    expect(screen.getByText("closed 2026-11-14, and it has open work again")).toBeInTheDocument();
  });

  test("shows no closing date for an open phase, and no goal line for a stage without one", () => {
    render(<Board status={reopened} />);

    expect(screen.getAllByText(/^closed /)).toHaveLength(1);
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
  });
});
