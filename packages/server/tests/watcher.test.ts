import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { initRecords, openRepo, writeJsonAtomic, type Config } from "@tally/core";
import { Watcher, fingerprint, snapshot } from "../src/watcher.ts";
import { makeRepo, sh } from "../../core/tests/support/repo.ts";

const config: Config = {
  schema: 1, name: "Test", mainBranch: "main", docsDir: "docs", tracks: [], stages: [],
  commands: { test: ["true"], env: {}, unset: [] }, fingerprint: { paths: ["src"], exclude: [] },
  identity: { name: "t", email: "t@example.com" }, records: { dir: "docs/records", commitPrefix: "records:", commit: false }, locks: [],
};

describe("the watcher", () => {
  test("the fingerprint changes when a ref, a working tree or the ledger changes, and not otherwise", async () => {
    const repo = await makeRepo();
    await initRecords(repo.root, config, (await repo.head()).slice(0, 7));
    await sh(repo.root, ["add", "-A"]);
    await sh(repo.root, ["commit", "-q", "-m", "records: init"]);
    const opened = await openRepo(repo.root);
    const first = await fingerprint(opened);
    expect(await fingerprint(opened)).toBe(first);
    await writeFile(join(repo.root, "new.txt"), "x");
    const dirty = await fingerprint(opened);
    expect(dirty).not.toBe(first);
    await repo.commit("new.txt", "x", "feat: new");
    const committed = await fingerprint(opened);
    expect(committed).not.toBe(dirty);
    await writeJsonAtomic(join(opened.recordsDir, "evidence", "A1.json"), { schema: 1, milestone: "A1", records: [] });
    expect(await fingerprint(opened)).not.toBe(committed);
  });

  test("a detached worktree moves neither the fingerprint nor the graph, whatever it holds", async () => {
    const repo = await makeRepo();
    await initRecords(repo.root, config, (await repo.head()).slice(0, 7));
    await repo.commit(".gitignore", ".temp/\n", "chore: ignore scratch");
    await sh(repo.root, ["add", "-A"]);
    await sh(repo.root, ["commit", "-q", "-m", "records: init"]);
    const opened = await openRepo(repo.root);
    const first = await fingerprint(opened);
    const checkout = join(repo.root, ".temp", "data", "landing");

    await sh(repo.root, ["worktree", "add", "-q", "--detach", checkout, "HEAD"]);
    await writeFile(join(checkout, "left.txt"), "x");
    await sh(checkout, ["add", "left.txt"]);
    await sh(checkout, ["commit", "-q", "-m", "undone by a landing"]);
    await writeFile(join(checkout, "dirty.txt"), "x");

    const { graph, graphTotal, status } = await snapshot(opened);
    expect(await fingerprint(opened)).toBe(first);
    expect(graph.map((commit) => commit.subject)).not.toContain("undone by a landing");
    expect(graphTotal).toBe(graph.length);
    expect(status.tracks.map((row) => row.branch)).toEqual(["main"]);
  });

  test("tells its subscribers on each change it sees (a commit shows a dirty tree, then the ref), and stops cleanly", async () => {
    const repo = await makeRepo();
    await initRecords(repo.root, config, (await repo.head()).slice(0, 7));
    await sh(repo.root, ["add", "-A"]);
    await sh(repo.root, ["commit", "-q", "-m", "records: init"]);
    const watcher = new Watcher(await openRepo(repo.root), { intervalMs: 30 });
    const seen: number[] = [];
    watcher.subscribe((snapshot) => seen.push(snapshot.graph.length));
    watcher.start();
    await new Promise((done) => setTimeout(done, 150));
    const before = seen.length;
    await repo.commit("c.txt", "c", "feat: c");
    const started = Date.now();
    while (seen.length === before && Date.now() - started < 3000) await new Promise((done) => setTimeout(done, 20));
    while (seen.at(-1) !== 3 && Date.now() - started < 3000) await new Promise((done) => setTimeout(done, 20));
    await watcher.stop();
    expect(seen.length).toBeGreaterThanOrEqual(before + 1);
    expect(seen.length).toBeLessThanOrEqual(before + 2);
    expect(seen.at(-1)).toBe(3);
    expect(watcher.lastFailure).toBeUndefined();
  });

  test("keeps a failing poll as its last failure instead of throwing, and stop waits for the tick in flight", async () => {
    const repo = await makeRepo();
    await initRecords(repo.root, config, (await repo.head()).slice(0, 7));
    const watcher = new Watcher(await openRepo(repo.root), { intervalMs: 20 });
    watcher.start();
    await rm(join(repo.root, ".git"), { recursive: true, force: true });
    const started = Date.now();
    while (watcher.lastFailure === undefined && Date.now() - started < 3000) await new Promise((done) => setTimeout(done, 20));
    await watcher.stop();
    expect(watcher.lastFailure).toMatch(/git/);
  });

  test("a snapshot that fails is taken again on the next poll, so no change is lost", async () => {
    const repo = await makeRepo();
    await initRecords(repo.root, config, (await repo.head()).slice(0, 7));
    await sh(repo.root, ["add", "-A"]);
    await sh(repo.root, ["commit", "-q", "-m", "records: init"]);
    const watcher = new Watcher(await openRepo(repo.root), { intervalMs: 20 });
    const seen: string[] = [];
    watcher.subscribe((snapshot) => seen.push(snapshot.status.main));
    const ledger = join(repo.root, "docs", "records", "ledger.json");
    const good = await readFile(ledger, "utf8");
    await writeFile(ledger, "{ not json");
    watcher.start();
    const started = Date.now();
    while (watcher.lastFailure === undefined && Date.now() - started < 3000) await new Promise((done) => setTimeout(done, 10));
    expect(watcher.lastFailure).toMatch(/not valid JSON/);
    expect(seen).toEqual([]);
    await writeFile(ledger, good);
    while (seen.length === 0 && Date.now() - started < 3000) await new Promise((done) => setTimeout(done, 10));
    await watcher.stop();
    expect(seen.length).toBe(1);
    expect(watcher.lastFailure).toBeUndefined();
  });
});
