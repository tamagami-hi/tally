// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { DoneSessions } from "../src/components/DoneSessions.tsx";
import { sessions } from "./done-fixture.ts";

afterEach(cleanup);

const rowOf = (id: string): HTMLElement => screen.getAllByRole("listitem").find((item) => item.dataset["session"] === id) as HTMLElement;

describe("the ended sessions in Done", () => {
  test("show one row per session: agent, track, when and how long, how it ended, its writes and its tasks", () => {
    render(<DoneSessions ended={sessions} canLoadMore={false} onMore={() => undefined} />);
    const first = within(rowOf("s1"));

    expect(first.getByText("kiro")).toBeInTheDocument();
    expect(first.getByText("beta")).toBeInTheDocument();
    expect(first.getByText("2026-11-14")).toBeInTheDocument();
    expect(first.getByText("10:02 to 11:47, 1 h 45 min")).toHaveAttribute("title", "from its opening to its last event");
    expect(first.getByText("closed")).toBeInTheDocument();
    expect(first.getByText("12 writes · B2 / 2 writer")).toBeInTheDocument();
  });

  test("say how each kind of session ended, and when its opening was not logged", () => {
    render(<DoneSessions ended={sessions} canLoadMore={false} onMore={() => undefined} />);

    expect(within(rowOf("s2")).getByText("expired")).toBeInTheDocument();
    expect(within(rowOf("s3")).getByText("no close recorded")).toBeInTheDocument();
    expect(within(rowOf("s2")).getByText("23:50 to 2026-11-14 00:30, 40 min")).toHaveAttribute("title", "from its first write (its opening was not logged) to its last event");
    expect(within(rowOf("s3")).getByText("1 write")).toBeInTheDocument();
  });

  test("name at most eight tasks and count the rest", () => {
    render(<DoneSessions ended={sessions} canLoadMore={false} onMore={() => undefined} />);

    expect(within(rowOf("s2")).getByText(/^12 writes · B2 \/ t0, .*B2 \/ t7 and 2 more$/)).toBeInTheDocument();
  });

  test("offer fifty more while there are more, and ask for them", () => {
    const asked: string[] = [];
    render(<DoneSessions ended={{ ...sessions, total: 80 }} canLoadMore onMore={() => asked.push("more")} />);

    fireEvent.click(screen.getByRole("button", { name: "Show 50 more" }));

    expect(asked).toEqual(["more"]);
    expect(screen.getByText("3 of 80 ended sessions")).toBeInTheDocument();
  });

  test("say how many it will load when fewer than fifty remain", () => {
    render(<DoneSessions ended={{ ...sessions, total: 10 }} canLoadMore onMore={() => undefined} />);

    expect(screen.getByRole("button", { name: "Show 7 more" })).toBeInTheDocument();
  });

  test("offer no more when every session is shown", () => {
    render(<DoneSessions ended={sessions} canLoadMore={false} onMore={() => undefined} />);

    expect(screen.queryByRole("button", { name: "Show 50 more" })).toBeNull();
  });

  test("say that older sessions are in the activity log when some day files were not read", () => {
    render(<DoneSessions ended={{ ...sessions, earlier: 4 }} canLoadMore={false} onMore={() => undefined} />);

    expect(screen.getByText(/Older sessions are in the activity log/)).toBeInTheDocument();
  });

  test("say that the repository keeps no activity log, and what turns it on", () => {
    render(<DoneSessions ended={{ kept: false, sessions: [], total: 0 }} canLoadMore={false} onMore={() => undefined} />);

    expect(screen.getByText(/This repository keeps no activity log/)).toBeInTheDocument();
    expect(screen.getByText('context: "records"')).toBeInTheDocument();
  });

  test("say so when no session has ended yet", () => {
    render(<DoneSessions ended={{ kept: true, sessions: [], total: 0 }} canLoadMore={false} onMore={() => undefined} />);

    expect(screen.getByText(/No session has ended yet\./)).toBeInTheDocument();
  });
});
