// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Evidence } from "../src/components/Evidence.tsx";
import { countsText, kindTone, secondsText, summaryText } from "../src/format.ts";
import type { EvidenceIndex } from "../src/types.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

export const index: EvidenceIndex = {
  milestones: [
    {
      milestone: "B4",
      records: [
        { id: "a".repeat(32), task: "data review fixes D1-D3", track: "data", agent: "import", kind: "red", command: ["cargo", "test", "--locked", "-p", "acme-core"], cwd: "/w/data", started: "2026-11-03T17:10:00.000Z", seconds: 3.2, exit: 101, log: { path: "/w/data/.temp/data/B4-fixes/D1-red.log", sha256: "0".repeat(64), bytes: 18478 }, summary: { passed: 0, failed: 3, ignored: 0 }, note: "indexed from .temp/data/B4-fixes/D1-red.json" },
        { id: "b".repeat(32), task: "data review fixes D1-D3", track: "data", agent: "import", kind: "green", command: ["cargo", "test"], cwd: "/w/data", started: "2026-11-03T17:12:00.000Z", seconds: 95, exit: 0, log: { path: "/w/data/.temp/data/B4-fixes/D1-green.log", sha256: "0".repeat(64), bytes: 1133 }, summary: { passed: 12, failed: 0, ignored: 0, head: "5de70884f9825ece" } },
        { id: "c".repeat(32), task: "data 6 replay seek/speed", track: "data", agent: "import", kind: "fmt", command: ["cargo", "fmt", "--check"], cwd: "/w/data", started: "2026-11-03T14:09:00.000Z", seconds: 0.693, exit: 0 },
      ],
    },
  ],
};

describe("formatting evidence", () => {
  test("tones a kind, prints seconds and a summary, and counts kinds", () => {
    expect(["red", "green", "land", "clippy", "other"].map(kindTone)).toEqual(["warn", "done", "accent", "idle", "line"]);
    expect([0.693, 3.2, 95, 3700].map(secondsText)).toEqual(["0.7 s", "3.2 s", "1 min 35 s", "61 min 40 s"]);
    expect(summaryText({ passed: 12, failed: 0, ignored: 0, head: "5de70884f9825ece" })).toBe("12 passed · 0 failed · 0 ignored · head 5de7088");
    expect(countsText(index.milestones[0]!.records)).toBe("1 red · 1 green · 1 fmt");
  });
});

describe("the evidence page", () => {
  test("says when nothing is recorded yet, and while loading", () => {
    render(<Evidence index={{ milestones: [] }} />);
    expect(screen.getByText(/No evidence records yet/)).toBeInTheDocument();
    cleanup();
    render(<Evidence index={undefined} />);
    expect(screen.getByLabelText("Evidence")).toHaveAttribute("aria-busy", "true");
  });

  test("lists each milestone's tasks with every run's kind, exit, seconds, summary and log, and opens a log in place", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: url.endsWith("a".repeat(32)), status: url.endsWith("a".repeat(32)) ? 200 : 410, text: async () => "test result: FAILED. 0 passed; 3 failed" })));
    render(<Evidence index={index} />);
    const page = screen.getByLabelText("Evidence");
    expect(within(page).getByRole("heading", { level: 3 })).toHaveTextContent("B4");
    expect(within(page).getByText("data review fixes D1-D3")).toBeInTheDocument();
    expect(within(page).getByText("1 red · 1 green")).toBeInTheDocument();
    expect(within(page).getByText("data 6 replay seek/speed")).toBeInTheDocument();
    const runs = within(page).getAllByRole("listitem").filter((li) => li.classList.contains("run"));
    expect(runs).toHaveLength(3);
    expect(runs[0]).toHaveTextContent("red");
    expect(runs[0]).toHaveTextContent("exit 101");
    expect(runs[0]).toHaveTextContent("3.2 s");
    expect(runs[0]).toHaveTextContent("0 passed · 3 failed · 0 ignored");
    expect(runs[0]).toHaveTextContent("D1-red.log");
    expect(runs[0]).toHaveTextContent("18,478 bytes");
    expect(within(runs[0]!).getByTitle("cargo test --locked -p acme-core")).toBeInTheDocument();
    expect(runs[2]).toHaveTextContent("no log");
    const details = runs[0]!.querySelector("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(within(runs[0]!).getByText(/0 passed; 3 failed/)).toBeInTheDocument());
    const gone = runs[1]!.querySelector("details")!;
    gone.open = true;
    fireEvent(gone, new Event("toggle"));
    await waitFor(() => expect(within(runs[1]!).getByText(/the server answered 410/)).toBeInTheDocument());
  });
});
