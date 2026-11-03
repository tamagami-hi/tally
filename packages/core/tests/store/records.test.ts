import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Records, findRepoRoot, initRecords, openRepo } from "../../src/store/records.ts";
import type { Config } from "../../src/schema/config.ts";
import { tmpDir } from "../support/tmp.ts";

const config: Config = {
  schema: 1,
  name: "Test",
  mainBranch: "main",
  docsDir: "docs",
  tracks: [{ name: "data", worktree: ".temp/worktrees/data", branch: "track/data" }],
  stages: [{ id: "A", name: "a", weight: 1 }],
  commands: { test: ["true"], env: {} },
  fingerprint: { paths: ["src"], exclude: [] },
  identity: { name: "t", email: "t@example.com" },
  records: { dir: "docs/records", commitPrefix: "records:", commit: false },
  locks: ["landing"],
};

describe("the records folder", () => {
  test("init writes the config and an empty ledger that open reads back", async () => {
    const root = await tmpDir();
    await initRecords(root, config, "d0ff4a5");
    const repo = await openRepo(root);
    expect(repo.config.name).toBe("Test");
    expect(repo.recordsDir).toBe(join(root, "docs/records"));
    const ledger = await new Records(repo).readLedger();
    expect(ledger).toEqual({ schema: 1, baseline: "d0ff4a5", milestones: [], other: [] });
  });

  test("init refuses to overwrite an existing records folder", async () => {
    const root = await tmpDir();
    await initRecords(root, config, "d0ff4a5");
    await expect(initRecords(root, config, "d0ff4a5")).rejects.toThrow(/already/);
  });

  test("finds the repository root from a folder inside it, and nothing outside one", async () => {
    const root = await tmpDir();
    await initRecords(root, config, "d0ff4a5");
    const inside = join(root, "crates", "x");
    await mkdir(inside, { recursive: true });
    expect(await findRepoRoot(inside)).toBe(root);
    expect(await findRepoRoot(await tmpDir())).toBeUndefined();
  });

  test("update applies two concurrent changes one after the other, under the lock", async () => {
    const root = await tmpDir();
    await initRecords(root, config, "d0ff4a5");
    const records = new Records(await openRepo(root));
    const add = (id: string) => records.update(async (ledger) => ({
      ledger: { ...ledger, other: [...ledger.other, { commit: id.padEnd(7, "0"), note: id }] },
      message: id,
    }));
    const messages = await Promise.all([add("a"), add("b"), add("c")]);
    expect(messages.sort()).toEqual(["a", "b", "c"]);
    expect((await records.readLedger()).other.map((o) => o.note).sort()).toEqual(["a", "b", "c"]);
  });

  test("update writes nothing when the change throws", async () => {
    const root = await tmpDir();
    await initRecords(root, config, "d0ff4a5");
    const records = new Records(await openRepo(root));
    await expect(records.update(async () => { throw new Error("no"); })).rejects.toThrow("no");
    expect((await records.readLedger()).other).toEqual([]);
  });
});
