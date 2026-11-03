import { describe, expect, test } from "vitest";
import { currentBranch, isAncestor, logLines, porcelain, resolveOnMain, verifyCommit, worktrees } from "../../src/git/refs.ts";
import { makeRepo, sh } from "../support/repo.ts";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

describe("reading git", () => {
  test("verifies a commit, its ancestry and its short form", async () => {
    const repo = await makeRepo();
    const first = await repo.head();
    const second = await repo.commit("a.txt", "a\n", "second");
    expect(await verifyCommit(repo.root, first.slice(0, 7))).toBe(first);
    expect(await verifyCommit(repo.root, "nothere")).toBeNull();
    expect(await isAncestor(repo.root, first, "main")).toBe(true);
    await sh(repo.root, ["checkout", "-q", "-b", "track/data", first]);
    const off = await repo.commit("b.txt", "b\n", "off main");
    expect(await isAncestor(repo.root, off, "main")).toBe(false);
    expect(await isAncestor(repo.root, second, "main")).toBe(true);
  });

  test("resolveOnMain answers the short hash of a commit on main and refuses the rest in ledger.py's words", async () => {
    const repo = await makeRepo();
    const first = await repo.head();
    const resolve = resolveOnMain(repo.root, "main");
    expect(await resolve(first)).toBe(first.slice(0, 7));
    await expect(resolve("deadbee")).rejects.toThrow("deadbee: no such commit");
    await sh(repo.root, ["checkout", "-q", "-b", "track/x"]);
    const off = await repo.commit("c.txt", "c\n", "off");
    await expect(resolve(off)).rejects.toThrow(`${off} is not on main yet; record it after it lands`);
  });

  test("logs a range as hash and subject, newest first", async () => {
    const repo = await makeRepo();
    const base = await repo.head();
    await repo.commit("a.txt", "a\n", "feat: a");
    const b = await repo.commit("b.txt", "b\n", "feat: b");
    expect(await logLines(repo.root, `${base}..main`)).toEqual([`${b.slice(0, 7)} feat: b`, expect.stringMatching(/^[0-9a-f]{7} feat: a$/)]);
  });

  test("names the branch, the dirty files and the worktrees", async () => {
    const repo = await makeRepo();
    expect(await currentBranch(repo.root)).toBe("main");
    await writeFile(join(repo.root, "new.txt"), "x");
    expect(await porcelain(repo.root)).toEqual(["?? new.txt"]);
    const tree = join(repo.root, ".temp", "worktrees", "data");
    await sh(repo.root, ["worktree", "add", "-q", tree, "-b", "track/data", "main"]);
    const found = await worktrees(repo.root);
    expect(found.get("main")).toBe(repo.root);
    expect(found.get("track/data")).toBe(tree);
    expect(await currentBranch(tree)).toBe("track/data");
  });
});
