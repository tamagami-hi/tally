// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/App.tsx";
import { snapshot } from "./fixture.ts";
import { index } from "./repos-fixture.ts";

interface Sent {
  path: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function serving(answers: Record<string, unknown>): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (input: string, init: RequestInit = {}) => {
    const path = input.split("?")[0] ?? input;
    sent.push({ path: input, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
    const answer = answers[`${init.method ?? "GET"} ${path}`];
    return Promise.resolve(answer === undefined ? new Response(JSON.stringify({ error: "not found" }), { status: 404 }) : new Response(JSON.stringify(answer), { status: 200 }));
  });
  return sent;
}

function at(path: string): void {
  window.history.pushState({}, "", path);
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <App />
    </QueryClientProvider>,
  );
}

const EMPTY = { "GET /api/r/alpha/evidence": { milestones: [] }, "GET /api/r/alpha/docs": { documents: [], records: [] }, "GET /api/evidence": { milestones: [] }, "GET /api/docs": { documents: [], records: [] } };
const paths = (sent: Sent[]): string[] => sent.map((request) => request.path);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("the page on a server for one repository", () => {
  test("shows that repository's board and no sidebar", async () => {
    const sent = serving({ ...EMPTY, "GET /api/snapshot": snapshot });

    at("/");

    expect(await screen.findByText("Example build status")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Repositories" })).toBeNull();
    expect(paths(sent)).toContain("/api/snapshot");
  });
});

describe("the page on a server for every repository", () => {
  test("shows the overview and the sidebar at the root, and asks for no board", async () => {
    const sent = serving({ "GET /api/repos": index });

    at("/");

    expect(await screen.findByRole("heading", { name: "Repositories" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Repositories" })).toBeInTheDocument();
    expect(paths(sent).filter((path) => path.includes("snapshot"))).toEqual([]);
  });

  test("shows a repository's board from that repository's own paths", async () => {
    const sent = serving({ ...EMPTY, "GET /api/repos": index, "GET /api/r/alpha/snapshot": snapshot });

    at("/r/alpha/");

    expect(await screen.findByText("Example build status")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Repositories" })).toBeInTheDocument();
    expect(paths(sent)).toContain("/api/r/alpha/snapshot");
    expect(paths(sent)).not.toContain("/api/snapshot");
  });

  test("adds a repository from the folder picker as the operator", async () => {
    const listing = { dir: "/work", parent: null, folders: [{ name: "gamma", path: "/work/gamma", isRepo: true, hasRecords: true, listed: null }] };
    const sent = serving({ "GET /api/repos": index, "GET /api/fs": listing, "POST /api/repos": { name: "gamma", root: "/work/gamma", started: false } });
    at("/");

    fireEvent.click(await screen.findByRole("button", { name: "Add repository" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add gamma" }));

    await waitFor(() => expect(sent.some((request) => request.method === "POST")).toBe(true));
    const posted = sent.find((request) => request.method === "POST");
    expect(posted?.path).toBe("/api/repos");
    expect(posted?.body).toEqual({ root: "/work/gamma" });
    expect(posted?.headers).toMatchObject({ "content-type": "application/json", "x-tally-operator": "1" });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Add a repository" })).toBeNull());
  });

  test("shows why the server refused an action", async () => {
    serving({ "GET /api/repos": index });
    at("/");

    fireEvent.click(await screen.findByRole("button", { name: "Make beta the default" }));

    expect(await screen.findByText("not found")).toHaveAttribute("role", "alert");
  });

  test("remembers that the sidebar was collapsed", async () => {
    serving({ "GET /api/repos": index });
    at("/");

    fireEvent.click(await screen.findByRole("button", { name: "Hide repositories" }));

    expect(screen.getByRole("button", { name: "Show repositories" })).toBeInTheDocument();
    expect(window.localStorage.getItem("tally.sidebar")).toBe("collapsed");
  });
});
