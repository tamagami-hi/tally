/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { BRANCH_HUES, branchColours, colourOf, mainOf, paintOf, rankBranches } from "../src/branches.ts";
import type { EvidenceIndex, EvidenceRecord, LiveState, TrackRow } from "../src/types.ts";

const SECOND = 1000;
const AT = Date.parse("2026-11-05T04:00:00.000Z");
const iso = (seconds: number): string => new Date(AT + seconds * SECOND).toISOString();
const ct = (seconds: number): number => AT / SECOND + seconds;

const track = (name: string, seconds = 0, isMain = false): TrackRow => ({
  branch: isMain ? name : `track/${name}`, track: name, path: ".", head: "abc1234", subject: "s", ct: ct(seconds), when: "now", ahead: 0, behind: 0, dirty: 0, files: [], isMain,
});
const MAIN = track("main", 0, true);
const nobody: LiveState = { sessions: [], claims: [], locks: [] };
const session = (name: string, seconds: number): LiveState["sessions"][number] => ({ id: name, track: name, agent: "a", openedAt: iso(seconds) });
const claim = (name: string, seconds: number): LiveState["claims"][number] => ({ milestone: "B1", task: "t", track: name, agent: "a", since: iso(seconds) });
const lock = (name: string, seconds: number): LiveState["locks"][number] => ({ name: "a-lock", agent: "a", track: name, note: "", since: iso(seconds) });
const run = (name: string, seconds: number): EvidenceRecord => ({ id: name, task: "t", track: name, agent: "a", kind: "green", command: ["x"], cwd: ".", started: iso(seconds), seconds: 1, exit: 0 });
const evidence = (...records: EvidenceRecord[]): EvidenceIndex => ({ milestones: [{ milestone: "B1", records }] });
const order = (rows: TrackRow[]): string[] => rows.map((row) => row.track);

describe("a colour per branch", () => {
  const tracks = [MAIN, track("alpha"), track("beta"), track("gamma")];

  test("main takes the one accent and every other branch its own hue", () => {
    const colours = branchColours(tracks);

    expect(colours.get("main")).toBe("var(--accent)");
    const hues = ["track/alpha", "track/beta", "track/gamma"].map((branch) => colours.get(branch));
    expect(new Set(hues).size).toBe(3);
    expect(hues.every((hue) => /^var\(--branch-\d\)$/.test(hue ?? ""))).toBe(true);
  });

  test("the same on every load, whatever order the rows come in", () => {
    expect([...branchColours([...tracks].reverse())].sort()).toEqual([...branchColours(tracks)].sort());
  });

  test("keyed on the names, so the activity order cannot repaint a card", () => {
    const state: LiveState = { ...nobody, sessions: [session("gamma", 10)] };

    expect(branchColours(rankBranches(tracks, state, undefined))).toEqual(branchColours(tracks));
  });

  test("keeps to the palette when there are more branches than hues", () => {
    const many = Array.from({ length: BRANCH_HUES + 1 }, (_, n) => track(`t${n}`));

    expect(branchColours(many).get("track/t0")).toBe(branchColours(many).get(`track/t${BRANCH_HUES}`));
  });

  test("a label with no card takes the quiet colour", () => {
    const colours = branchColours(tracks);

    expect(colourOf(colours, "v1.0")).toBe("var(--idle)");
    expect(colourOf(colours, null)).toBe("var(--idle)");
    expect(paintOf(colours, "main")).toEqual({ "--branch": "var(--accent)" });
  });

  test("names main from the rows, and falls back on the usual name", () => {
    expect(mainOf([track("alpha"), track("trunk", 0, true)])).toBe("trunk");
    expect(mainOf([track("alpha")])).toBe("main");
  });
});

describe("the stylesheet behind the colours", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const themeOf = (name: string): string => css.slice(css.indexOf(name), css.indexOf("}", css.indexOf(name)));

  test.each([":root {", ':root[data-theme="dark"] {'])("%s defines every hue the palette promises", (theme) => {
    const hues = Array.from({ length: BRANCH_HUES }, (_, n) => `--branch-${n}:`);

    expect(hues.filter((hue) => !themeOf(theme).includes(hue))).toEqual([]);
  });

  test("every corner comes from the one radius token", () => {
    expect(css.match(/border-radius:[^;]*/g)?.filter((rule) => rule !== "border-radius: var(--radius)")).toEqual([]);
  });

  test("no card carries a shadow", () => {
    expect(css).not.toContain("box-shadow: var(--shadow)");
  });
});

describe("sorting the branch cards by activity", () => {
  test("main comes first however idle it is", () => {
    const rows = rankBranches([track("alpha", 100), track("main", -100, true)], nobody, undefined);

    expect(order(rows)).toEqual(["main", "alpha"]);
  });

  test("the newest commit comes first among the idle", () => {
    const rows = rankBranches([MAIN, track("alpha", 1), track("beta", 3), track("gamma", 2)], nobody, undefined);

    expect(order(rows)).toEqual(["main", "beta", "gamma", "alpha"]);
  });

  test("a live session ranks above an idle branch with a newer commit", () => {
    const state: LiveState = { ...nobody, sessions: [session("alpha", -500)] };

    expect(order(rankBranches([MAIN, track("beta", 100), track("alpha", -900)], state, undefined))).toEqual(["main", "alpha", "beta"]);
  });

  test("a claim ranks as a live session does", () => {
    const state: LiveState = { ...nobody, claims: [claim("alpha", -500)] };

    expect(order(rankBranches([MAIN, track("beta", 100), track("alpha", -900)], state, undefined))).toEqual(["main", "alpha", "beta"]);
  });

  test("between live branches the newest event leads, claim or session or commit", () => {
    const state: LiveState = { ...nobody, sessions: [session("alpha", 10), session("beta", 5)], claims: [claim("beta", 20)] };

    expect(order(rankBranches([MAIN, track("alpha"), track("beta"), track("gamma", 15)], state, undefined))).toEqual(["main", "beta", "alpha", "gamma"]);
  });

  test("a recorded run or a lock counts as an event on an idle branch, but neither makes it live", () => {
    const state: LiveState = { ...nobody, sessions: [session("zeta", -100)], locks: [lock("alpha", 30)] };
    const runs = evidence(run("beta", 40));

    const rows = rankBranches([MAIN, track("alpha"), track("beta"), track("gamma", 20), track("zeta", -100)], state, runs);

    expect(order(rows)).toEqual(["main", "zeta", "beta", "alpha", "gamma"]);
  });

  test("ties keep the order the rows came in, so equal cards do not jump", () => {
    const rows = [MAIN, track("gamma", 5), track("alpha", 5), track("beta", 5)];

    expect(order(rankBranches(rows, nobody, undefined))).toEqual(["main", "gamma", "alpha", "beta"]);
    expect(order(rankBranches(rows, { ...nobody }, evidence()))).toEqual(["main", "gamma", "alpha", "beta"]);
  });

  test("a time it cannot read counts for nothing", () => {
    const state: LiveState = { ...nobody, locks: [{ ...lock("alpha", 0), since: "not a time" }] };

    expect(order(rankBranches([MAIN, track("alpha", 1), track("beta", 2)], state, undefined))).toEqual(["main", "beta", "alpha"]);
  });

  test("works before the live state and the evidence have arrived, and leaves its input alone", () => {
    const rows = [track("alpha", 1), MAIN, track("beta", 2)];
    const before = [...rows];

    expect(order(rankBranches(rows, undefined, undefined))).toEqual(["main", "beta", "alpha"]);
    expect(rows).toEqual(before);
  });
});
