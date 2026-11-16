// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Done } from "../src/components/Done.tsx";
import { sessions, work } from "./done-fixture.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200): Promise<Response> => Promise.resolve(new Response(JSON.stringify(body), { status }));

function serving(answer: (url: string) => Promise<Response>): string[] {
  const asked: string[] = [];
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    asked.push(url);
    return answer(url);
  }));
  return asked;
}

const both = (url: string): Promise<Response> => (url.includes("/done/sessions") ? json(sessions) : json(work));

describe("the Done view", () => {
  test("shows a skeleton while it loads, then the phases and tasks", async () => {
    let release: (response: Response) => void = () => undefined;
    serving(() => new Promise((done) => { release = done; }));
    render(<Done version="v1" />);

    expect(screen.getByLabelText("Done")).toHaveAttribute("aria-busy", "true");
    await act(async () => release(new Response(JSON.stringify(work))));
    expect(await screen.findByText("1 phase closed · 2 milestones finished · 4 tasks landed")).toBeInTheDocument();
  });

  test("says in a sentence when the read failed, and tries again", async () => {
    let fails = true;
    const asked = serving((url) => (fails ? json({ error: "gone" }, 500) : both(url)));
    render(<Done version="v1" />);

    expect(await screen.findByText(/The finished work could not be read: the server answered 500: gone\./)).toBeInTheDocument();
    fails = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("1 phase closed · 2 milestones finished · 4 tasks landed")).toBeInTheDocument();
    expect(asked).toEqual(["/api/done", "/api/done"]);
  });

  test("switches between the phases and tasks and the sessions, reading the sessions only when they are shown", async () => {
    const asked = serving(both);
    render(<Done version="v1" />);
    await screen.findByText(/1 phase closed/);

    expect(screen.getByRole("radio", { name: "Phases and tasks" })).toHaveAttribute("aria-checked", "true");
    expect(asked).toEqual(["/api/done"]);
    fireEvent.click(screen.getByRole("radio", { name: "Sessions" }));

    expect(await screen.findByText("kiro")).toBeInTheDocument();
    expect(asked).toEqual(["/api/done", "/api/done/sessions?limit=50"]);
  });

  test("loads fifty more sessions with a larger limit, keeping the ones shown while it loads", async () => {
    let release: (response: Response) => void = () => undefined;
    const asked = serving((url) => (url.endsWith("limit=100") ? new Promise((done) => { release = done; }) : url.includes("sessions") ? json({ ...sessions, total: 80 }) : json(work)));
    render(<Done version="v1" />);
    fireEvent.click(screen.getByRole("radio", { name: "Sessions" }));
    await screen.findByText("kiro");

    fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }));

    expect(asked.at(-1)).toBe("/api/done/sessions?limit=100");
    expect(screen.getByText("kiro")).toBeInTheDocument();
    await act(async () => release(new Response(JSON.stringify({ ...sessions, total: 3 }))));
    expect(screen.queryByRole("button", { name: "Show 50 more" })).toBeNull();
  });

  test("reads again when a new snapshot arrives", async () => {
    const asked = serving(both);
    const { rerender } = render(<Done version="v1" />);
    await screen.findByText(/1 phase closed/);

    rerender(<Done version="v2" />);

    await vi.waitFor(() => expect(asked).toEqual(["/api/done", "/api/done"]));
  });
});
