import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { NO_CHECK, startRecords } from "../../src/repos/start.ts";
import { makeRepo, sh } from "../support/repo.ts";
import { tmpDir } from "../support/tmp.ts";

const IDENTITY = { identity: { name: "service", email: "service@example.com" } };

describe("starting a repository's records", () => {
  test("writes a config and an empty ledger at main's tip, and commits them", async () => {
    const git = await makeRepo();
    const tip = (await git.head()).slice(0, 7);

    const repo = await startRecords(git.root, IDENTITY);

    expect(repo.config.mainBranch).toBe("main");
    expect(repo.config.stages).toEqual([{ id: "build", name: "the build", weight: 100 }]);
    expect(JSON.parse(await readFile(join(git.root, "docs/records/ledger.json"), "utf8"))).toEqual({ schema: 1, baseline: tip, milestones: [], other: [] });
    expect(await sh(git.root, ["log", "-1", "--format=%s"])).toBe("records: start tracking");
    expect(await sh(git.root, ["show", "--stat", "--format=", "HEAD"])).toContain("docs/records/config.json");
  });

  test.each([["package.json", ["npm", "test"]], ["Cargo.toml", ["cargo", "test"]], ["pyproject.toml", ["pytest"]], ["go.mod", ["go", "test", "./..."]]])("reads the check from %s", async (file, command) => {
    const git = await makeRepo();
    await git.commit(file, "", "chore: a project file");

    expect((await startRecords(git.root, IDENTITY)).config.commands.test).toEqual(command);
  });

  test("sets a check that fails by design when it can read none", async () => {
    const git = await makeRepo();

    expect((await startRecords(git.root, IDENTITY)).config.commands.test).toEqual(NO_CHECK);
  });

  test("uses the repository's own identity before the service's", async () => {
    const git = await makeRepo();
    await sh(git.root, ["config", "user.name", "the owner"]);
    await sh(git.root, ["config", "user.email", "owner@example.com"]);

    expect((await startRecords(git.root, IDENTITY)).config.identity).toEqual({ name: "the owner", email: "owner@example.com" });
  });

  test("keeps .temp/ out of git without changing a tracked file", async () => {
    const git = await makeRepo();

    await startRecords(git.root, IDENTITY);

    expect(await readFile(join(git.root, ".git/info/exclude"), "utf8")).toContain(".temp/\n");
    expect(await sh(git.root, ["status", "--porcelain"])).toBe("");
  });

  test("leaves the exclude file alone when .temp/ is ignored already", async () => {
    const git = await makeRepo();
    await git.commit(".gitignore", ".temp/\n", "chore: ignore");
    const before = await readFile(join(git.root, ".git/info/exclude"), "utf8").catch(() => "");

    await startRecords(git.root, IDENTITY);

    expect(await readFile(join(git.root, ".git/info/exclude"), "utf8").catch(() => "")).toBe(before);
  });

  test("is refused for a repository with no commit yet", async () => {
    const root = await tmpDir("tally-empty-");
    await sh(root, ["init", "-q", "-b", "main"]);

    await expect(startRecords(root, IDENTITY)).rejects.toThrow(`${root} has no commit yet; make its first commit, then add it`);
  });

  test("is refused for a checkout that is on no branch", async () => {
    const git = await makeRepo();
    await sh(git.root, ["checkout", "-q", "--detach"]);

    await expect(startRecords(git.root, IDENTITY)).rejects.toThrow(`${git.root} is on no branch; check out its main branch, then add it`);
  });
});
