import { describe, expect, test } from "vitest";
import { GRAPH_LIMIT, commitCount, commitGraph, graphBranches, layOut, type Commit } from "../src/graph.ts";
import { makeRepo, sh } from "../../core/tests/support/repo.ts";

const BRANCHES = ["main", "track/data"];

const commit = (hash: string, parents: string[], labels: string[] = []): Commit => ({
  hash, parents, subject: hash, author: "t", ct: 0, when: "just now", labels, pushed: false,
});

describe("laying out the graph", () => {
  test("a linear history sits in one lane with a line above and below each dot", () => {
    const laid = layOut([commit("c", ["b"]), commit("b", ["a"]), commit("a", [])]);
    expect(laid.map((c) => c.lane)).toEqual([0, 0, 0]);
    expect(laid[0]).toMatchObject({ top: [], bottom: [[0, 0]], width: 1 });
    expect(laid[1]).toMatchObject({ top: [[0, 0]], bottom: [[0, 0]] });
    expect(laid[2]).toMatchObject({ top: [[0, 0]], bottom: [] });
  });

  test("a branch takes a second lane until it joins its base", () => {
    const laid = layOut([commit("track", ["base"], ["track/data"]), commit("main", ["base"], ["main"]), commit("base", [])]);
    expect(laid.map((c) => [c.hash, c.lane])).toEqual([["track", 0], ["main", 1], ["base", 0]]);
    expect(laid[1]!.bottom).toEqual(expect.arrayContaining([[0, 0], [1, 0]]));
    expect(laid[2]!.top).toEqual([[0, 0]]);
    expect(Math.max(...laid.map((c) => c.width))).toBe(2);
  });
});

describe("reading the graph from git", () => {
  test("labels branches, marks what origin has, and orders by date", async () => {
    const repo = await makeRepo();
    await repo.commit("a.txt", "a", "feat: a");
    await sh(repo.root, ["checkout", "-q", "-b", "track/data"]);
    const off = await repo.commit("b.txt", "b", "feat: b");
    const graph = await commitGraph(repo.root, BRANCHES, 10);
    expect(graph[0]).toMatchObject({ hash: off.slice(0, 7), subject: "feat: b", labels: ["track/data"], pushed: false });
    expect(graph.find((c) => c.labels.includes("main"))?.subject).toBe("feat: a");
    expect(graph.every((c) => c.author === "tester")).toBe(true);
    expect(graph).toHaveLength(3);
  });
});

describe("only the project's own branches", () => {
  test("leaves out a branch no track owns, with its commits and its label", async () => {
    const repo = await makeRepo();
    await repo.commit("a.txt", "a", "feat: a");
    await sh(repo.root, ["branch", "stray/here"]);
    await sh(repo.root, ["checkout", "-q", "-b", "stray/old"]);
    await repo.commit("s.txt", "s", "feat: stray");
    await sh(repo.root, ["checkout", "-q", "main"]);

    const graph = await commitGraph(repo.root, BRANCHES, 10);

    expect(graph.map((c) => c.subject)).not.toContain("feat: stray");
    expect(graph.flatMap((c) => c.labels)).toEqual(["main"]);
    expect(await commitCount(repo.root, BRANCHES)).toBe(graph.length);
  });

  test("keeps origin's main, and passes over a track whose branch git no longer has", async () => {
    const repo = await makeRepo();
    await repo.commit("a.txt", "a", "feat: a");
    await sh(repo.root, ["update-ref", "refs/remotes/origin/main", "HEAD"]);

    const graph = await commitGraph(repo.root, ["main", "track/gone"], 10);

    expect(graph[0]?.labels).toEqual(expect.arrayContaining(["main", "origin/main"]));
  });

  test("names main and every track in the config", () => {
    const tracks = [{ name: "a", worktree: "w", branch: "track/a" }, { name: "b", worktree: "x", branch: "track/b" }];

    expect(graphBranches({ mainBranch: "trunk", tracks })).toEqual(["trunk", "track/a", "track/b"]);
  });
});

describe("a graph of any length", () => {
  async function branched() {
    const repo = await makeRepo();
    await repo.commit("a.txt", "a", "feat: a");
    await sh(repo.root, ["checkout", "-q", "-b", "track/data"]);
    await repo.commit("b.txt", "b", "feat: b");
    await sh(repo.root, ["checkout", "-q", "main"]);
    await repo.commit("c.txt", "c", "feat: c");
    await repo.commit("d.txt", "d", "feat: d");
    return repo;
  }

  test("stops at its limit, and the total counts every commit on every branch", async () => {
    const repo = await branched();

    expect(await commitGraph(repo.root, BRANCHES, 2)).toHaveLength(2);
    expect(await commitCount(repo.root, BRANCHES)).toBe(5);
    expect(await commitGraph(repo.root, BRANCHES, 100)).toHaveLength(5);
  });

  test("a larger limit keeps the rows a smaller one drew, lanes and all", async () => {
    const repo = await branched();
    const now = 2_000_000_000;

    const short = await commitGraph(repo.root, BRANCHES, 3, now);
    const long = await commitGraph(repo.root, BRANCHES, 5, now);

    expect(long.slice(0, 3)).toEqual(short);
  });

  test("the default stays at the live snapshot's size", async () => {
    const repo = await makeRepo();
    for (let n = 0; n < GRAPH_LIMIT; n += 1) await sh(repo.root, ["commit", "-q", "--allow-empty", "-m", `commit ${n}`]);

    expect(await commitGraph(repo.root, BRANCHES)).toHaveLength(GRAPH_LIMIT);
    expect(await commitCount(repo.root, BRANCHES)).toBe(GRAPH_LIMIT + 1);
  });
});
