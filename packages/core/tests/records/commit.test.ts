import { describe, expect, test } from "vitest";
import { commitRecords } from "../../src/records/commit.ts";
import type { Config } from "../../src/schema/config.ts";
import { Records, initRecords, openRepo } from "../../src/store/records.ts";
import { makeRepo, sh } from "../support/repo.ts";

const config = (commit: boolean): Config => ({
  schema: 1,
  name: "Test",
  mainBranch: "main",
  docsDir: "docs",
  tracks: [],
  stages: [],
  commands: { test: ["true"], env: {}, unset: [] },
  fingerprint: { paths: ["src"], exclude: [] },
  identity: { name: "operator", email: "operator@example.com" },
  records: { dir: "docs/records", commitPrefix: "records:", commit },
  locks: ["landing"],
});

describe("committing the records", () => {
  test("commits only the records folder, as the operator, with the prefix, and nothing when nothing changed", async () => {
    const git = await makeRepo();
    await initRecords(git.root, config(true), (await git.head()).slice(0, 7));
    const repo = await openRepo(git.root);
    await sh(git.root, ["add", "-A"]);
    await sh(git.root, ["commit", "-q", "-m", "records: init"]);
    expect(await commitRecords(repo, "nothing")).toBeNull();
    const records = new Records(repo);
    await records.update((ledger) => ({ ledger: { ...ledger, other: [{ commit: "abc1234", note: "x" }] }, message: "x" }));
    const { writeFile } = await import("node:fs/promises");
    await writeFile(`${git.root}/stray.txt`, "not records");
    const sha = await commitRecords(repo, "land B2 '1'");
    expect(sha).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(git.root, ["log", "-1", "--format=%an|%s"])).toBe("operator|records: land B2 '1'");
    expect(await sh(git.root, ["show", "--stat", "--format=", "HEAD"])).toContain("docs/records/ledger.json");
    expect(await sh(git.root, ["status", "--porcelain"])).toBe("?? stray.txt");
  });

  test("does nothing when the config turns records commits off", async () => {
    const git = await makeRepo();
    await initRecords(git.root, config(false), (await git.head()).slice(0, 7));
    const repo = await openRepo(git.root);
    expect(await commitRecords(repo, "x")).toBeNull();
    expect(await sh(git.root, ["status", "--porcelain", "-uall"])).toContain("docs/records/");
  });
});
