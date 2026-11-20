// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ToolsByUse } from "../src/components/ToolsByUse.tsx";
import type { UsageRanking } from "../src/types.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const AT = "2026-11-20T09:00:00.000Z";
const counts = { refused: 0, cut: 0, invalid: 0, first: AT, last: AT, days: 1, by: {}, via: {}, repos: {} };

const ranking: UsageRanking = {
  since: AT,
  versions: [{ version: "0.7.0", since: AT }],
  tools: [
    { name: "board_get", listed: true, chars: 912, calls: 40, ...counts, refused: 2 },
    { name: "ledger_check", listed: true, chars: 1_204, calls: 3, ...counts },
    { name: "old_tool", listed: false, chars: 0, calls: 1, ...counts },
  ],
  never: { tools: ["lock_list", "docs_search"], chars: 1_500 },
};

function answering(...answers: (() => Promise<Response>)[]) {
  const server = vi.fn(() => (answers.shift() ?? answers.at(-1) ?? (() => Promise.reject(new Error("no answer"))))());
  vi.stubGlobal("fetch", server);
  return server;
}

describe("the tools by use", () => {
  test("lists the tools most called first, with their counts and what each costs, and those never called", async () => {
    answering(() => Promise.resolve(new Response(JSON.stringify(ranking))));

    render(<ToolsByUse />);

    const table = await screen.findByRole("table", { name: "Tools by use" });
    const rows = within(table).getAllByRole("row").slice(1).map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent));
    expect(rows[0]).toEqual(["board_get", "40", "2", "0", "0", "1", "912"]);
    expect(rows[1]?.[0]).toBe("ledger_check");
    expect(rows[2]?.[0]).toBe("old_tool (not listed)");
    expect(screen.getByText(/Never called: 2 tools, 1,500 characters of the list/)).toHaveTextContent("lock_list, docs_search");
    expect(screen.getByText(/Counted since/)).toHaveTextContent("0.7.0");
  });

  test("says when the count could not be read, and reads it again on Try again", async () => {
    const server = answering(() => Promise.resolve(new Response(JSON.stringify({ error: "down" }), { status: 500 })), () => Promise.resolve(new Response(JSON.stringify(ranking))));

    render(<ToolsByUse />);

    expect(await screen.findByText(/The count of tool calls could not be read: the server answered 500/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Tools by use" })).toBeInTheDocument();
    expect(server).toHaveBeenCalledTimes(2);
  });

  test("says so when nothing has been called yet", async () => {
    answering(() => Promise.resolve(new Response(JSON.stringify({ ...ranking, tools: [] }))));

    render(<ToolsByUse />);

    expect(await screen.findByText(/No tool has been called since/)).toBeInTheDocument();
  });
});
