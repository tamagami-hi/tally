import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { initRecords, openRepo, type Config } from "@tally/core";
import { Watcher, fingerprint } from "../src/watcher.ts";
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
    expect(await fingerprint(opened)).not.toBe(dirty);
  });

  test("tells its subscribers once per change and stops cleanly", async () => {
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
    watcher.stop();
    expect(seen.length).toBe(before + 1);
    expect(seen.at(-1)).toBe(3);
  });
});
