// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Tracks } from "../src/components/Tracks.tsx";
import type { LiveState, LiveTicket } from "../src/types.ts";
import { snapshot } from "./fixture.ts";

afterEach(cleanup);

const queue = (entries: LiveTicket[]): LiveState => ({ sessions: [], claims: [], locks: [], queue: entries });

describe("a track that is landing", () => {
  test("says its checks are running while it has its turn", () => {
    render(<Tracks status={snapshot.status} state={queue([{ ticket: "t1", track: "alpha", agent: "claude", state: "turn", since: "2026-11-12T10:00:00Z" }])} />);

    const track = screen.getByText("track/alpha").closest("li") as HTMLElement;
    expect(within(track).getByText("landing: checks running")).toBeInTheDocument();
  });

  test("says where it waits in the queue", () => {
    render(<Tracks status={snapshot.status} state={queue([{ ticket: "t0", track: "beta", agent: "kiro", state: "turn", since: "s" }, { ticket: "t1", track: "alpha", agent: "claude", state: "queued", since: "s" }])} />);

    const track = screen.getByText("track/alpha").closest("li") as HTMLElement;
    expect(within(track).getByText("in the landing queue, 1 ahead")).toBeInTheDocument();
  });

  test("shows nothing about landing for a track with no ticket", () => {
    render(<Tracks status={snapshot.status} state={queue([])} />);

    expect(screen.queryByText(/landing/)).toBeNull();
  });
});
