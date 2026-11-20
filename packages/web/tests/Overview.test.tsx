// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Overview } from "../src/components/Overview.tsx";
import { index } from "./repos-fixture.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the overview", () => {
  test("shows each repository's project, progress and counts, with a link to its board", () => {
    render(<Overview index={index} />);

    const alpha = screen.getByRole("link", { name: "alpha" }).closest("article") as HTMLElement;
    expect(screen.getByRole("link", { name: "alpha" })).toHaveAttribute("href", "/r/alpha/");
    expect(within(alpha).getByText("Alpha")).toBeInTheDocument();
    expect(within(alpha).getByText("/work/alpha")).toBeInTheDocument();
    expect(within(alpha).getByLabelText("alpha 50%")).toBeInTheDocument();
    expect(within(alpha).getByText("2 working")).toBeInTheDocument();
  });

  test("shows a repository's problem beside it", () => {
    render(<Overview index={index} />);

    const beta = screen.getByRole("link", { name: "beta" }).closest("article") as HTMLElement;
    expect(within(beta).getByRole("alert")).toHaveTextContent("its config.json is not valid JSON");
  });

  test("shows a problem with the list itself", () => {
    render(<Overview index={{ ...index, problem: "repos.json is not valid JSON" }} />);

    expect(screen.getByText(/repos\.json is not valid JSON/)).toBeInTheDocument();
  });

  test("says how to begin when nothing is listed", () => {
    render(<Overview index={{ workspace: "/work", repos: [] }} />);

    expect(screen.getByText("No repository is listed yet. Add one from the sidebar: tally can track any git repository under /work.")).toBeInTheDocument();
  });

  test("shows the tools by use below the repositories", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(JSON.stringify({ since: "2026-11-20T09:00:00.000Z", versions: [], tools: [], never: { tools: ["board_get"], chars: 900 } })))));

    render(<Overview index={index} />);

    expect(await screen.findByRole("region", { name: "Tools by use" })).toHaveTextContent("Never called: 1 tools");
  });
});
