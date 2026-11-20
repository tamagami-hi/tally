// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ToConfirm } from "../src/components/ToConfirm.tsx";
import type { ToConfirmRow } from "../src/types.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rows: ToConfirmRow[] = [
  { id: "DEC-4", group: "core", text: "The reader reads JSON only.", said: "yes, JSON only", via: { session: "s-1", track: "main", agent: "coordinator" }, on: "2026-11-21T09:00:00.000Z" },
  { id: "DEC-5", group: "web", text: "No dark mode yet.", said: "later", via: { session: "s-1", track: "main", agent: "coordinator" }, disputed: true },
];

describe("the decisions to confirm", () => {
  test("show each decision recorded on the operator's word, with the words and who recorded them", () => {
    render(<ToConfirm decisions={rows} />);

    const list = screen.getByRole("region", { name: "Decisions to confirm" });
    const first = within(list).getAllByRole("listitem")[0]!;
    expect(first).toHaveTextContent("core DEC-4");
    expect(first).toHaveTextContent("The reader reads JSON only.");
    expect(first).toHaveTextContent("“yes, JSON only”");
    expect(first).toHaveTextContent("recorded by coordinator on main");
    expect(within(list).getAllByRole("listitem")[1]).toHaveTextContent("marked not yours");
  });

  test("Confirm and Not mine post the operator's mark for that decision", async () => {
    const server = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ decision: {} }))));
    vi.stubGlobal("fetch", server);
    render(<ToConfirm decisions={rows} />);
    const [first, second] = screen.getAllByRole("listitem");

    fireEvent.click(within(first!).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(server).toHaveBeenCalledTimes(1));
    fireEvent.click(within(second!).getByRole("button", { name: "Not mine" }));
    await waitFor(() => expect(server).toHaveBeenCalledTimes(2));

    const calls = server.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([url, init]) => [url, init.method, (init.headers as Record<string, string>)["x-tally-operator"]])).toEqual([["/api/operator/decisions/core/DEC-4/confirm", "POST", "1"], ["/api/operator/decisions/web/DEC-5/dispute", "POST", "1"]]);
  });

  test("say when a mark did not go through", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ error: "a cycle close is being finished" }), { status: 400 }))));
    render(<ToConfirm decisions={rows} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Confirm" })[0]!);

    expect(await screen.findByRole("alert")).toHaveTextContent("That did not go through: a cycle close is being finished.");
  });

  test("show nothing when no decision waits", () => {
    const { container } = render(<ToConfirm decisions={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
