import { describe, expect, test } from "vitest";
import { commitGraph, layOut, type Commit } from "../src/graph.ts";
import { makeRepo, sh } from "../../core/tests/support/repo.ts";

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
    const graph = await commitGraph(repo.root, 10);
    expect(graph[0]).toMatchObject({ hash: off.slice(0, 7), subject: "feat: b", labels: ["track/data"], pushed: false });
    expect(graph.find((c) => c.labels.includes("main"))?.subject).toBe("feat: a");
    expect(graph.every((c) => c.author === "tester")).toBe(true);
    expect(graph).toHaveLength(3);
  });
});
