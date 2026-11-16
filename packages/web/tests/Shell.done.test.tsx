// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Shell } from "../src/Shell.tsx";
import type { Layout } from "../src/types.ts";
import { sessions, work } from "./done-fixture.ts";
import { snapshot } from "./fixture.ts";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(url.includes("sessions") ? sessions : work)))));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const draw = (layout: Layout) => render(<Shell snapshot={snapshot} error={null} live="connected" layout={layout} scheme="light" evidence={{ milestones: [] }} onToggleScheme={() => undefined} onRetry={() => undefined} />);

describe("the Done view in the shell", () => {
  test("sits after the board in landscape's switch, and draws no hero", async () => {
    draw("landscape");

    expect(within(screen.getByRole("radiogroup", { name: "Main view" })).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Board", "Done", "Evidence", "Docs"]);
    fireEvent.click(screen.getByRole("radio", { name: "Done" }));

    expect(await screen.findByText(/1 phase closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Overall progress")).toBeNull();
    expect(screen.queryByLabelText("Board")).toBeNull();
  });

  test("is a page of portrait's bottom bar, after the graph, and draws no hero", async () => {
    draw("portrait");

    expect(within(screen.getByRole("radiogroup", { name: "Pages" })).getAllByRole("radio").map((radio) => radio.textContent)).toEqual(["Board", "Tracks", "Graph", "Done", "Evidence", "Docs"]);
    fireEvent.click(screen.getByRole("radio", { name: "Done" }));

    expect(await screen.findByText(/1 phase closed/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Done" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByLabelText("Overall progress")).toBeNull();
  });

  test.each(["landscape", "portrait"] as const)("opens from the board's button in %s", async (layout) => {
    draw(layout);

    fireEvent.click(screen.getByRole("button", { name: "1 finished milestone is in Done" }));

    expect(await screen.findByText(/1 phase closed/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Board")).toBeNull();
  });
});
