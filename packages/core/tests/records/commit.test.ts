import { describe, expect, test, vi } from "vitest";
import { commitRecords, flushRecords, flushWhenFree } from "../../src/records/commit.ts";
import type { Config } from "../../src/schema/config.ts";
import { Records, initRecords, openRepo } from "../../src/store/records.ts";
import { busyLock } from "../support/busy.ts";
import { makeRepo, sh } from "../support/repo.ts";

const config = (commit: boolean, batch?: boolean): Config => ({
  schema: 1,
  name: "Test",
  mainBranch: "main",
  docsDir: "docs",
  tracks: [],
  stages: [],
  commands: { test: ["true"], env: {}, unset: [] },
  fingerprint: { paths: ["src"], exclude: [] },
  identity: { name: "operator", email: "operator@example.com" },
  records: { dir: "docs/records", commitPrefix: "records:", commit, ...(batch === undefined ? {} : { batch }) },
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

  test("in batch mode leaves every change on disk, then makes one commit of them all", async () => {
    const git = await makeRepo();
    await initRecords(git.root, config(true, true), (await git.head()).slice(0, 7));
    const repo = await openRepo(git.root);
    await sh(git.root, ["add", "-A"]);
    await sh(git.root, ["commit", "-q", "-m", "records: init"]);
    const head = (await sh(git.root, ["rev-parse", "--short=7", "HEAD"])).trim();
    const records = new Records(repo);
    const note = (commit: string) => records.update((ledger) => ({ ledger: { ...ledger, other: [...ledger.other, { commit, note: "x" }] }, message: "x" }));

    await note("abc1234");
    const first = await commitRecords(repo, "one");
    await note("abc1235");
    const second = await commitRecords(repo, "two");

    expect([first, second]).toEqual([null, null]);
    expect((await sh(git.root, ["rev-parse", "--short=7", "HEAD"])).trim()).toBe(head);
    expect(await sh(git.root, ["status", "--porcelain"])).toContain("docs/records/ledger.json");
    expect((await new Records(repo).readLedger()).other).toHaveLength(2);

    const sha = await flushRecords(repo);

    expect(sha).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(git.root, ["log", "-1", "--format=%an|%s"])).toBe(`operator|records: 1 record file up to ${head}`);
    expect(await sh(git.root, ["rev-list", "--count", `${head}..HEAD`])).toBe("1");
    expect(await sh(git.root, ["status", "--porcelain"])).toBe("");
    expect(await flushRecords(repo)).toBeNull();
  });

  test("a flush commits nothing when the config turns records commits off", async () => {
    const git = await makeRepo();
    await initRecords(git.root, config(false), (await git.head()).slice(0, 7));
    expect(await flushRecords(await openRepo(git.root))).toBeNull();
  });

  test("waits for the landing lock, so a landing in flight never sees main move under it", async () => {
    const git = await makeRepo();
    await initRecords(git.root, config(true), (await git.head()).slice(0, 7));
    const repo = await openRepo(git.root);
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, other: [{ commit: "abc1234", note: "x" }] }, message: "x" }));
    const order: string[] = [];
    const { withLock } = await import("../../src/store/lock.ts");
    const { statePath } = await import("../../src/land/paths.ts");
    let acquired = (): void => undefined;
    const holding = new Promise<void>((done) => { acquired = done; });
    const held = withLock(statePath(repo, "locks", "landing.lock"), async () => {
      acquired();
      await new Promise((done) => setTimeout(done, 300));
      order.push("released");
    });
    await holding;
    const committed = commitRecords(repo, "x").then((sha) => order.push(sha === null ? "nothing" : "committed"));
    await Promise.all([held, committed]);
    expect(order).toEqual(["released", "committed"]);
  });

  test("a landing lock it cannot take leaves the written change for the next commit, and fails nothing", async () => {
    const git = await makeRepo();
    await initRecords(git.root, config(true), (await git.head()).slice(0, 7));
    const repo = await openRepo(git.root);
    await sh(git.root, ["add", "-A"]);
    await sh(git.root, ["commit", "-q", "-m", "records: init"]);
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, other: [{ commit: "abc1234", note: "x" }] }, message: "x" }));
    busyLock("landing.lock");

    expect(await commitRecords(repo, "first")).toBeNull();
    expect(await sh(git.root, ["log", "-1", "--format=%s"])).toBe("records: init");
    expect(await sh(git.root, ["status", "--porcelain"])).toContain("docs/records/ledger.json");

    vi.restoreAllMocks();
    expect(await commitRecords(repo, "second")).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(git.root, ["show", "--stat", "--format=%s", "HEAD"])).toContain("docs/records/ledger.json");
    expect(await sh(git.root, ["status", "--porcelain"])).toBe("");
  });

  test("an asked-for flush says the lock stopped it, and a session's closing flush leaves the records waiting", async () => {
    const git = await makeRepo();
    await initRecords(git.root, config(true, true), (await git.head()).slice(0, 7));
    const repo = await openRepo(git.root);
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, other: [{ commit: "abc1234", note: "x" }] }, message: "x" }));
    busyLock("landing.lock");

    await expect(flushRecords(repo)).rejects.toThrow(/landing\.lock .*nothing was changed/);
    expect(await flushWhenFree(repo)).toBeNull();

    expect(await sh(git.root, ["status", "--porcelain", "-uall"])).toContain("docs/records/ledger.json");
  });

  test("does nothing when the config turns records commits off", async () => {
    const git = await makeRepo();
    await initRecords(git.root, config(false), (await git.head()).slice(0, 7));
    const repo = await openRepo(git.root);
    expect(await commitRecords(repo, "x")).toBeNull();
    expect(await sh(git.root, ["status", "--porcelain", "-uall"])).toContain("docs/records/");
  });

  test("waits for another git process's index.lock to go away before adding and committing", async () => {
    const git = await makeRepo();
    await initRecords(git.root, config(true), (await git.head()).slice(0, 7));
    const repo = await openRepo(git.root);
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, other: [{ commit: "abc1234", note: "x" }] }, message: "x" }));
    const { rm, writeFile } = await import("node:fs/promises");
    await writeFile(`${git.root}/.git/index.lock`, "");
    setTimeout(() => void rm(`${git.root}/.git/index.lock`), 250);
    expect(await commitRecords(repo, "after the lock")).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(git.root, ["log", "-1", "--format=%s"])).toBe("records: after the lock");
  });
});
