// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Shell, type ShellProps } from "../src/Shell.tsx";
import type { LaidCommit, Layout, Snapshot } from "../src/types.ts";
import { snapshot } from "./fixture.ts";

const ROW = 44;
const TALL = 10_000;
const VIEW = 500;
const LOADING = "Loading more commits…";

interface Asked {
  url: string;
  answer: (body: unknown) => Promise<void>;
  refuse: () => Promise<void>;
}

const commit = (n: number): LaidCommit => ({ hash: `c${n}`, parents: [`c${n - 1}`], subject: `commit ${n}`, author: "t", ct: 0, when: "now", labels: [], pushed: false, lane: 0, top: [[0, 0]], bottom: [[0, 0]], width: 1 });
const newest = (head: number, count: number): LaidCommit[] => Array.from({ length: count }, (_, index) => commit(head - index));
const live = (head: number, total = head): Snapshot => ({ ...snapshot, graph: newest(head, Math.min(60, total)), graphTotal: total, takenAt: `at ${head}` });
const rows = (): NodeListOf<Element> => screen.getByLabelText("Commit graph").querySelectorAll("li");

let asked: Asked[] = [];
let content = TALL;
let stretched = false;
let listTop = 0;

beforeEach(() => {
  asked = [];
  content = TALL;
  stretched = false;
  listTop = 0;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function rect(this: Element) {
    return { top: this.classList.contains("graph-rows") ? listTop : 0 } as DOMRect;
  });
  vi.spyOn(Element.prototype, "scrollHeight", "get").mockImplementation(() => content);
  vi.spyOn(Element.prototype, "clientHeight", "get").mockImplementation(function clientHeight(this: Element) {
    return stretched && this.classList.contains("panel-body") ? content : VIEW;
  });
  vi.stubGlobal("fetch", vi.fn((url: string) => new Promise((done) => {
    const settle = (response: unknown) => act(async () => {
      done(response);
      await Promise.resolve();
    });
    asked.push({ url, answer: (body) => settle({ ok: true, status: 200, json: async () => body }), refuse: () => settle({ ok: false, status: 500 }) });
  })));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.scrollTop = 0;
});

function open(layout: Layout, first: Snapshot = live(200)) {
  const props: ShellProps = { snapshot: first, error: null, live: "connected", layout, scheme: "light", evidence: { milestones: [] }, onToggleScheme: () => undefined, onRetry: () => undefined };
  const view = render(<Shell {...props} />);
  if (layout === "portrait") fireEvent.click(screen.getByRole("radio", { name: "Graph" }));
  const body = screen.getByLabelText("Commit graph").parentElement!;
  body.style.overflowY = "auto";
  stretched = layout === "portrait";
  const scroller = layout === "portrait" ? document.documentElement : body;
  const target = layout === "portrait" ? document : body;
  return {
    scroller,
    scrollTo: (top: number) => {
      scroller.scrollTop = top;
      fireEvent.scroll(target);
    },
    atBottom: () => {
      scroller.scrollTop = content - VIEW;
      fireEvent.scroll(target);
    },
    update: (next: Snapshot) => view.rerender(<Shell {...props} snapshot={next} />),
  };
}

describe.each(["landscape", "portrait"] as const)("the graph in %s", (layout) => {
  test("loads nothing until the list nears the bottom, then asks from the top with the larger limit", async () => {
    const { scrollTo, atBottom } = open(layout);
    expect(rows()).toHaveLength(60);

    scrollTo(1_000);
    expect(asked).toEqual([]);
    atBottom();

    expect(asked.map((a) => a.url)).toEqual(["/api/graph?limit=160"]);
    expect(screen.getByText(LOADING)).toBeInTheDocument();
    content = TALL * 2;
    await asked[0]?.answer({ commits: newest(200, 160), total: 200 });
    await waitFor(() => expect(rows()).toHaveLength(160));
    expect(screen.queryByText(LOADING)).toBeNull();
    expect(asked).toHaveLength(1);
  });

  test("asks once however many scroll events come while it loads", () => {
    const { atBottom } = open(layout);

    atBottom();
    atBottom();
    atBottom();

    expect(asked).toHaveLength(1);
  });

  test("stops asking once every commit is loaded", async () => {
    const { atBottom } = open(layout, live(130));

    atBottom();
    expect(asked.map((a) => a.url)).toEqual(["/api/graph?limit=130"]);
    await asked[0]?.answer({ commits: newest(130, 130), total: 130 });
    await waitFor(() => expect(rows()).toHaveLength(130));
    atBottom();

    expect(asked).toHaveLength(1);
    expect(screen.queryByText(LOADING)).toBeNull();
  });

  test("keeps the loaded length and the view when a new commit arrives", async () => {
    const { atBottom, scrollTo, scroller, update } = open(layout);
    atBottom();
    content = TALL * 2;
    await asked[0]?.answer({ commits: newest(200, 160), total: 200 });
    await waitFor(() => expect(rows()).toHaveLength(160));
    scrollTo(3_000);

    update(live(201));

    expect(rows()).toHaveLength(160);
    expect(scroller.scrollTop).toBe(3_000);
    expect(asked.at(-1)?.url).toBe("/api/graph?limit=161");
    await asked.at(-1)?.answer({ commits: newest(201, 161), total: 201 });
    await waitFor(() => expect(rows()).toHaveLength(161));
    expect(scroller.scrollTop).toBe(3_000 + ROW);
    expect(screen.getByText("commit 201")).toBeInTheDocument();
    expect(screen.getByText("commit 41")).toBeInTheDocument();
  });

  test("keeps the view when a new commit arrives before anything was loaded", () => {
    const { scrollTo, scroller, update } = open(layout);
    scrollTo(1_000);

    update(live(202));

    expect(rows()).toHaveLength(60);
    expect(scroller.scrollTop).toBe(1_000 + 2 * ROW);
    expect(asked).toEqual([]);
  });

  test("holds still when a rebase rewrites rows above the view and the row in view has not moved", () => {
    const { scrollTo, scroller, update } = open(layout);
    scrollTo(ROW * 30);
    listTop = -ROW * 30;
    const rows = newest(200, 60);
    const rewritten = [commit(901), commit(902), commit(903), ...rows.filter((_, index) => ![5, 9, 12].includes(index))];

    update({ ...live(200), graph: rewritten, takenAt: "rebased" });

    expect(scroller.scrollTop).toBe(ROW * 30);
  });

  test("follows the row in view when it is pushed down, however the rows above it changed", () => {
    const { scrollTo, scroller, update } = open(layout);
    scrollTo(ROW * 30);
    listTop = -ROW * 30;
    const rewritten = [commit(901), commit(902), commit(903), commit(904), ...newest(200, 60).slice(3)];

    update({ ...live(200, 201), graph: rewritten, takenAt: "rebased with one more" });

    expect(scroller.scrollTop).toBe(ROW * 31);
  });

  test("falls back to the next row that survived when the row in view was itself rewritten", () => {
    const { scrollTo, scroller, update } = open(layout);
    scrollTo(ROW * 30);
    listTop = -ROW * 30;
    const rows = newest(200, 60);
    const rewritten = [commit(901), ...rows.slice(0, 30), commit(902), ...rows.slice(31)];

    update({ ...live(200, 202), graph: rewritten, takenAt: "row in view rewritten" });

    expect(scroller.scrollTop).toBe(ROW * 31);
  });

  test("stays at the very top, so a new commit is seen arriving", () => {
    const { scroller, update } = open(layout);

    update(live(201));

    expect(scroller.scrollTop).toBe(0);
    expect(screen.getByText("commit 201")).toBeInTheDocument();
  });
});

describe("loading the graph", () => {
  test("never asks when the snapshot already holds everything", () => {
    const { atBottom } = open("landscape", live(40));

    atBottom();

    expect(rows()).toHaveLength(40);
    expect(asked).toEqual([]);
  });

  test("keeps going without a scroll while the list does not fill the view", async () => {
    open("landscape");
    content = VIEW;
    fireEvent(window, new Event("resize"));

    expect(asked.map((a) => a.url)).toEqual(["/api/graph?limit=160"]);
    await asked[0]?.answer({ commits: newest(200, 160), total: 200 });
    await waitFor(() => expect(asked.map((a) => a.url)).toEqual(["/api/graph?limit=160", "/api/graph?limit=200"]));
  });

  test("leaves a reply a newer request has overtaken", async () => {
    const { atBottom, update } = open("landscape");
    atBottom();
    update(live(201));
    expect(asked.map((a) => a.url)).toEqual(["/api/graph?limit=160", "/api/graph?limit=161"]);

    await asked[1]?.answer({ commits: newest(201, 161), total: 201 });
    await waitFor(() => expect(rows()).toHaveLength(161));
    await asked[0]?.answer({ commits: newest(200, 160), total: 200 });

    expect(rows()).toHaveLength(161);
  });

  test("says when a batch failed, stops asking, and tries again when told", async () => {
    const { atBottom } = open("landscape");
    atBottom();

    await asked[0]?.refuse();

    await waitFor(() => expect(screen.getByText(/Could not load more commits/)).toBeInTheDocument());
    expect(screen.queryByText(LOADING)).toBeNull();
    atBottom();
    expect(asked).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(asked.map((a) => a.url)).toEqual(["/api/graph?limit=160", "/api/graph?limit=160"]);
    content = TALL * 2;
    await asked[1]?.answer({ commits: newest(200, 160), total: 200 });
    await waitFor(() => expect(rows()).toHaveLength(160));
    expect(screen.queryByText(/Could not load more commits/)).toBeNull();
  });

  test("the legend counts what is loaded", async () => {
    const { atBottom } = open("landscape");
    expect(screen.getByText("not pushed · 60")).toBeInTheDocument();
    atBottom();
    content = TALL * 2;

    await asked[0]?.answer({ commits: newest(200, 160), total: 200 });

    await waitFor(() => expect(screen.getByText("not pushed · 160")).toBeInTheDocument());
  });

  test("a snapshot with no new commits fetches nothing", async () => {
    const { atBottom, update } = open("landscape");
    atBottom();
    content = TALL * 2;
    await asked[0]?.answer({ commits: newest(200, 160), total: 200 });
    await waitFor(() => expect(rows()).toHaveLength(160));

    update({ ...live(200), takenAt: "later" });

    expect(asked).toHaveLength(1);
    expect(rows()).toHaveLength(160);
  });
});
