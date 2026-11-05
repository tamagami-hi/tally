import { describe, expect, test } from "vitest";
import { forkLanes } from "../src/lanes.ts";
import type { DrawnCommit, LaidCommit, Stroke } from "../src/types.ts";

const BRANCHES = ["main", "track/a", "track/b"];

const row = (hash: string, parents: string[], labels: string[] = []): LaidCommit => ({
  hash, parents, subject: hash, author: "t", ct: 0, when: "now", labels, pushed: false, lane: 0, top: [], bottom: [], width: 1,
});
const draw = (rows: LaidCommit[]): DrawnCommit[] => forkLanes(rows, "main", BRANCHES);
const lanes = (rows: DrawnCommit[]): Record<string, number> => Object.fromEntries(rows.map((r) => [r.hash, r.lane]));
const bends = (strokes: Stroke[]): Stroke[] => strokes.filter((s) => s.from !== s.to);
const widest = (rows: DrawnCommit[]): number => Math.max(...rows.map((r) => r.width));

describe("main's lane", () => {
  test("a linear history sits on lane 0 with a line above and below each commit", () => {
    const drawn = draw([row("c", ["b"], ["main"]), row("b", ["a"]), row("a", [])]);

    expect(lanes(drawn)).toEqual({ c: 0, b: 0, a: 0 });
    expect(drawn[0]).toMatchObject({ top: [], bottom: [{ from: 0, to: 0, branch: "main" }], width: 1, branch: "main" });
    expect(drawn[1]).toMatchObject({ top: [{ from: 0, to: 0, branch: "main" }], bottom: [{ from: 0, to: 0, branch: "main" }] });
    expect(drawn[2]).toMatchObject({ top: [{ from: 0, to: 0, branch: "main" }], bottom: [] });
  });

  test("names the main branch the config names, whatever it is called", () => {
    const drawn = forkLanes([row("t", ["m"], ["track/a"]), row("m", [], ["trunk"])], "trunk", ["trunk", "track/a"]);

    expect(lanes(drawn)).toEqual({ t: 1, m: 0 });
  });

  test("draws nothing on its lane above main's own tip", () => {
    const drawn = draw([row("t", ["m"], ["track/a"]), row("m", [], ["main"])]);

    expect(drawn[0]?.top).toEqual([]);
    expect(drawn[0]?.bottom.filter((s) => s.from === 0)).toEqual([]);
  });
});

describe("a branch ahead of main", () => {
  test("its commit sits on its own lane and leaves main at the fork, in the branch's name", () => {
    const drawn = draw([row("t", ["m"], ["track/a"]), row("m", ["base"], ["main"]), row("base", [])]);

    expect(lanes(drawn)).toEqual({ t: 1, m: 0, base: 0 });
    expect(drawn[0]).toMatchObject({ branch: "track/a", width: 2 });
    expect(bends(drawn[1]!.top)).toEqual([{ from: 1, to: 0, branch: "track/a" }]);
    expect(drawn[1]?.branch).toBe("main");
    expect(widest(drawn.slice(2))).toBe(1);
  });

  test("every commit ahead stays on the lane, and the lane carries the branch", () => {
    const drawn = draw([row("t2", ["t1"], ["track/a"]), row("t1", ["m"]), row("m", [], ["main"])]);

    expect(lanes(drawn)).toEqual({ t2: 1, t1: 1, m: 0 });
    expect(drawn[1]).toMatchObject({ branch: "track/a", top: [{ from: 1, to: 1, branch: "track/a" }] });
  });

  test("when main moved on, the lane runs past main's newer commits down to the fork", () => {
    const drawn = draw([row("m3", ["m2"], ["main"]), row("t", ["m1"], ["track/a"]), row("m2", ["m1"]), row("m1", ["m0"]), row("m0", [])]);

    expect(lanes(drawn)).toEqual({ m3: 0, t: 1, m2: 0, m1: 0, m0: 0 });
    expect(drawn[2]?.top).toEqual([{ from: 0, to: 0, branch: "main" }, { from: 1, to: 1, branch: "track/a" }]);
    expect(bends(drawn[3]!.top)).toEqual([{ from: 1, to: 0, branch: "track/a" }]);
    expect(drawn[4]?.width).toBe(1);
  });

  test("two branches off one commit keep their own lanes and both leave at that commit", () => {
    const drawn = draw([row("a", ["m"], ["track/a"]), row("b", ["m"], ["track/b"]), row("m", [], ["main"])]);

    expect(lanes(drawn)).toEqual({ a: 1, b: 2, m: 0 });
    expect(bends(drawn[2]!.top)).toEqual([{ from: 1, to: 0, branch: "track/a" }, { from: 2, to: 0, branch: "track/b" }]);
  });

  test("a branch built on another shares its lane, each in its own colour from its own tip down", () => {
    const drawn = draw([row("b", ["a"], ["track/b"]), row("a", ["m"], ["track/a"]), row("m", [], ["main"])]);

    expect(lanes(drawn)).toEqual({ b: 1, a: 1, m: 0 });
    expect(drawn[1]).toMatchObject({ branch: "track/a", top: [{ from: 1, to: 1, branch: "track/b" }] });
    expect(bends(drawn[2]!.top)).toEqual([{ from: 1, to: 0, branch: "track/a" }]);
  });

  test("two branches that part above main join at the commit they share", () => {
    const drawn = draw([row("a", ["x"], ["track/a"]), row("b", ["x"], ["track/b"]), row("x", ["m"]), row("m", [], ["main"])]);

    expect(lanes(drawn)).toEqual({ a: 1, b: 2, x: 1, m: 0 });
    expect(bends(drawn[2]!.top)).toEqual([{ from: 2, to: 1, branch: "track/b" }]);
    expect(drawn[2]?.branch).toBe("track/a");
  });

  test("a finished lane is free for the next branch", () => {
    const drawn = draw([row("m2", ["m1"], ["main"]), row("a", ["m1"], ["track/a"]), row("m1", ["m0"]), row("b", ["m0"], ["track/b"]), row("m0", [])]);

    expect(lanes(drawn)).toEqual({ m2: 0, a: 1, m1: 0, b: 1, m0: 0 });
    expect(widest(drawn)).toBe(2);
  });
});

describe("a branch that is not ahead", () => {
  test("at main it draws no fork and stays a label", () => {
    const drawn = draw([row("m", ["base"], ["main", "track/a"]), row("base", [])]);

    expect(lanes(drawn)).toEqual({ m: 0, base: 0 });
    expect(widest(drawn)).toBe(1);
    expect(drawn[0]?.labels).toEqual(["main", "track/a"]);
  });

  test("behind main it draws no fork and stays a label", () => {
    const drawn = draw([row("m", ["behind"], ["main"]), row("behind", ["base"], ["track/a"]), row("base", [])]);

    expect(widest(drawn)).toBe(1);
    expect(drawn[1]).toMatchObject({ lane: 0, branch: "main", labels: ["track/a"] });
  });

  test("the fork is gone once main fast-forwards past the branch", () => {
    const ahead = draw([row("t", ["m"], ["track/a"]), row("m", [], ["main"])]);
    const landed = draw([row("t", ["m"], ["main", "track/a"]), row("m", [])]);

    expect(widest(ahead)).toBe(2);
    expect(widest(landed)).toBe(1);
    expect(lanes(landed)).toEqual({ t: 0, m: 0 });
  });
});

describe("the edges of a history", () => {
  test("a merge on main keeps main on lane 0 and joins its side lane", () => {
    const drawn = draw([row("merge", ["m", "side"], ["main"]), row("side", ["base"]), row("m", ["base"]), row("base", [])]);

    expect(lanes(drawn)).toEqual({ merge: 0, side: 1, m: 0, base: 0 });
    expect(bends(drawn[0]!.bottom)).toEqual([{ from: 0, to: 1, branch: null }]);
    expect(bends(drawn[3]!.top)).toEqual([{ from: 1, to: 0, branch: null }]);
  });

  test("a merge reaches a parent another lane already holds", () => {
    const drawn = draw([row("t", ["m", "m"], ["track/a"]), row("m", [], ["main"])]);

    expect(drawn[0]?.lane).toBe(1);
    expect(drawn[1]?.lane).toBe(0);
  });

  test("with main's tip below the loaded rows, a branch keeps off lane 0", () => {
    const drawn = draw([row("t2", ["t1"], ["track/a"]), row("t1", ["t0"])]);

    expect(lanes(drawn)).toEqual({ t2: 1, t1: 1 });
  });

  test("a row no branch names has no branch to take a colour from", () => {
    const drawn = draw([row("stray", ["m"], ["origin/main"]), row("m", [], ["main"])]);

    expect(drawn[0]).toMatchObject({ lane: 1, branch: null });
    expect(bends(drawn[1]!.top)).toEqual([{ from: 1, to: 0, branch: null }]);
  });

  test("more rows keep what fewer rows drew, lanes and all", () => {
    const rows = [row("t2", ["t1"], ["track/a"]), row("m2", ["m1"], ["main"]), row("t1", ["m1"]), row("m1", ["m0"]), row("b", ["m0"], ["track/b"]), row("m0", [])];

    expect(draw(rows).slice(0, 3)).toEqual(draw(rows.slice(0, 3)));
    expect(draw(rows).slice(0, 5)).toEqual(draw(rows.slice(0, 5)));
  });

  test("leaves the rows it was given as they were", () => {
    const rows = [row("t", ["m"], ["track/a"]), row("m", [], ["main"])];
    const before = structuredClone(rows);

    draw(rows);

    expect(rows).toEqual(before);
  });
});
