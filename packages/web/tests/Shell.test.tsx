// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Shell, type ShellProps } from "../src/Shell.tsx";
import { snapshot } from "./fixture.ts";

afterEach(cleanup);

function draw(overrides: Partial<ShellProps> = {}) {
  const props: ShellProps = { snapshot, error: null, live: "connected", layout: "landscape", scheme: "light", onToggleScheme: () => undefined, onRetry: () => undefined, ...overrides };
  return render(<Shell {...props} />);
}

describe("the shell in landscape", () => {
  test("shows the top bar, the hero, the three columns and the board's numbers", () => {
    draw();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Example build status");
    expect(screen.getByText(/^Live · updated/)).toBeInTheDocument();
    expect(screen.getByLabelText("Overall 52%")).toHaveTextContent("52%");
    expect(screen.getByLabelText("Tracks")).toBeInTheDocument();
    expect(screen.getByLabelText("Commit graph")).toBeInTheDocument();
    const board = screen.getByLabelText("Board");
    expect(within(board).getByText("B4")).toBeInTheDocument();
    expect(within(board).getByText("18/23")).toBeInTheDocument();
    expect(within(board).getByText(/T8 candle_close/)).toBeInTheDocument();
    expect(within(board).getByText("T9 store waits for B2")).toBeInTheDocument();
    expect(screen.getByText("42 unpushed")).toBeInTheDocument();
    expect(screen.getByText("2 · 1 with uncommitted work")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Pages" })).toBeNull();
  });

  test("lists the branches with their changes", () => {
    draw();
    const tracks = screen.getByLabelText("Tracks");
    expect(within(tracks).getByText("track/alpha")).toBeInTheDocument();
    expect(within(tracks).getByText("+0 / -2")).toBeInTheDocument();
    expect(within(tracks).getByText("2 uncommitted")).toBeInTheDocument();
    expect(within(tracks).getByText("clean")).toBeInTheDocument();
    expect(within(tracks).getByText("✓ Nothing uncommitted")).toBeInTheDocument();
    expect(within(tracks).getByTitle("crates/core/src/store/manifest.rs")).toBeInTheDocument();
  });

  test("draws one dot per commit, hollow when not pushed, and labels the branches", () => {
    draw();
    const graph = screen.getByLabelText("Commit graph");
    expect(graph.querySelectorAll("circle.dot")).toHaveLength(3);
    expect(graph.querySelectorAll("circle.dot.local")).toHaveLength(2);
    expect(within(graph).getByText("main")).toBeInTheDocument();
    expect(within(graph).getByText("origin/main")).toBeInTheDocument();
    expect(screen.getByText("not pushed · 2")).toBeInTheDocument();
  });

  test("shows the ledger's problems as an alert", () => {
    draw({ snapshot: { ...snapshot, status: { ...snapshot.status, problems: ["commits on main not in the ledger: abc1234 x"] } } });
    expect(screen.getByRole("alert")).toHaveTextContent("Ledger needs attention");
  });
});

describe("the shell in portrait", () => {
  test("shows the hero, one page at a time, and switches with the bottom navigation", () => {
    draw({ layout: "portrait" });
    expect(screen.getByRole("radiogroup", { name: "Pages" })).toBeInTheDocument();
    expect(screen.getByLabelText("Overall 52%")).toBeInTheDocument();
    expect(screen.getByLabelText("Board")).toBeInTheDocument();
    expect(screen.queryByLabelText("Commit graph")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Graph" }));
    expect(screen.getByLabelText("Commit graph")).toBeInTheDocument();
    expect(screen.queryByLabelText("Board")).toBeNull();
    expect(screen.getByRole("radio", { name: "Graph" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "Evidence" }));
    expect(screen.getByText(/No evidence records yet/)).toBeInTheDocument();
  });
});

describe("loading and failure", () => {
  test("shows a skeleton while loading and a retry when the server is unreachable", () => {
    draw({ snapshot: undefined });
    expect(screen.getByLabelText("Loading")).toBeInTheDocument();
    cleanup();
    let retried = 0;
    draw({ snapshot: undefined, error: new Error("the server answered 503"), onRetry: () => { retried += 1; } });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retried).toBe(1);
    expect(screen.getByText(/answered 503/)).toBeInTheDocument();
  });
});
