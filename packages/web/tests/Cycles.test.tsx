// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Cycles } from "../src/components/Cycles.tsx";
import type { CycleListing } from "../src/types.ts";
import { work } from "./done-fixture.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const listing: CycleListing = {
  current: { n: 3, since: "2026-11-19T10:00:00.000Z", milestones: { open: 2, finished: 1, carried: 1 }, tasks: { landed: 4, total: 7 }, complete: true, blockers: [], ask: "everything planned in cycle 3 has landed: ask the operator whether to close it; cycle_close takes their words in `said`" },
  closed: [
    { n: 2, name: "the writer", closedAt: "2026-11-19T10:00:00.000Z", closedBy: { track: "main", agent: "operator" }, summary: "The writer shipped.", said: "yes, close it", from: "abc1234", to: "def5678", milestones: 3, tasks: 9 },
    { n: 1, closedAt: "2026-11-10T10:00:00.000Z", closedBy: { track: "main", agent: "operator" }, summary: "The reader shipped.", said: "close the first", from: "aaa1111", to: "abc1234", milestones: 2, tasks: 4 },
  ],
  matched: 2,
};

function serving(answers: Record<string, () => Promise<Response>>) {
  const server = vi.fn((url: string) => {
    const key = Object.keys(answers).find((one) => url.endsWith(one));
    return key === undefined ? Promise.resolve(new Response(JSON.stringify({ error: "no" }), { status: 404 })) : answers[key]!();
  });
  vi.stubGlobal("fetch", server);
  return server;
}

const json = (value: unknown) => () => Promise.resolve(new Response(JSON.stringify(value)));

describe("the Cycles page", () => {
  test("shows the current cycle first, with its counts and the sentence that asks, then the closed ones newest first", async () => {
    serving({ "/cycles": json(listing) });

    render(<Cycles version="v1" />);

    const current = await screen.findByRole("region", { name: "Cycle 3, the current cycle" });
    expect(current).toHaveTextContent("1 of 3 milestones finished · 4 of 7 tasks landed");
    expect(current).toHaveTextContent("ask the operator whether to close it");
    const closed = screen.getAllByRole("group", { name: /^Cycle \d+$/ }).map((one) => within(one).getByRole("heading").textContent);
    expect(closed).toEqual(["Cycle 2: the writer", "Cycle 1"]);
    expect(screen.getByText("The writer shipped.")).toBeInTheDocument();
    expect(screen.getByText("“yes, close it”")).toBeInTheDocument();
  });

  test("unfolds a closed cycle into its phases, milestones and tasks, read when it is opened", async () => {
    const server = serving({ "/cycles": json(listing), "/cycles/2/done": json(work) });
    render(<Cycles version="v1" />);
    const second = (await screen.findAllByRole("group", { name: /^Cycle \d+$/ }))[0]!;

    const folded = second.querySelector("details")!;
    folded.open = true;
    fireEvent(folded, new Event("toggle"));

    expect(await within(second).findByText("the reader")).toBeInTheDocument();
    expect(server.mock.calls.map(([url]) => url)).toContain("/api/cycles/2/done");
  });

  test("says when no cycle has been closed", async () => {
    serving({ "/cycles": json({ ...listing, closed: [], matched: 0, current: { ...listing.current, n: 1, complete: false, ask: undefined } }) });

    render(<Cycles version="v1" />);

    expect(await screen.findByText("No cycle has been closed yet: cycle_close closes the current one, on the operator's word.")).toBeInTheDocument();
  });

  test("says when the cycles could not be read, and reads them again on Try again", async () => {
    let calls = 0;
    serving({ "/cycles": () => (calls++ === 0 ? Promise.resolve(new Response(JSON.stringify({ error: "down" }), { status: 500 })) : json(listing)()) });

    render(<Cycles version="v1" />);

    expect(await screen.findByText(/The cycles could not be read: the server answered 500: down/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Cycle 3, the current cycle" })).toBeInTheDocument();
  });

  test("says how many closed cycles it shows when there are more than it lists", async () => {
    serving({ "/cycles": json({ ...listing, matched: 23 }) });

    render(<Cycles version="v1" />);

    expect(await screen.findByText("The newest 2 of 23 closed cycles are shown.")).toBeInTheDocument();
  });

  test("reads an unfolded closed cycle once, however many snapshots come after", async () => {
    const server = serving({ "/cycles": json(listing), "/cycles/2/done": json(work) });
    const { rerender } = render(<Cycles version="v1" />);
    const second = (await screen.findAllByRole("group", { name: /^Cycle \d+$/ }))[0]!;
    const folded = second.querySelector("details")!;
    folded.open = true;
    fireEvent(folded, new Event("toggle"));
    await within(second).findByText("the reader");

    rerender(<Cycles version="v2" />);
    rerender(<Cycles version="v3" />);
    await screen.findAllByRole("group", { name: /^Cycle \d+$/ });

    expect(server.mock.calls.filter(([url]) => String(url).endsWith("/cycles/2/done"))).toHaveLength(1);
  });
});

