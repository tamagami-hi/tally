import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { landTrack, type LandDeps } from "../../src/land/run.ts";
import type { Config } from "../../src/schema/config.ts";
import { initRecords, openRepo, type Repo } from "../../src/store/records.ts";
import { makeRepo, sh } from "../support/repo.ts";

const config = (test: string[]): Config => ({
  schema: 1,
  name: "Test",
  mainBranch: "main",
  docsDir: "docs",
  tracks: [{ name: "data", worktree: ".temp/worktrees/data", branch: "track/data" }],
  stages: [{ id: "A", name: "a", weight: 1 }],
  commands: { test, env: { TALLY_TEST_MARK: "1" }, unset: ["CARGO_TARGET_DIR"], tmpdir: ".temp/{track}/tmp" },
  fingerprint: { paths: ["src", "Cargo.toml"], exclude: ["*.md"] },
  identity: { name: "operator", email: "operator@example.com" },
  records: { dir: "docs/records", commitPrefix: "records:", commit: false },
  locks: ["landing"],
});

interface Fixture {
  repo: Repo;
  root: string;
  tree: string;
  message: string;
  ran: string[][];
  deps: LandDeps;
}

async function fixture(test = ["true"]): Promise<Fixture> {
  const git = await makeRepo();
  await git.commit(".gitignore", ".temp/\n", "chore: ignore scratch");
  await git.commit("src/lib.rs", "fn a() {}\n", "feat: a");
  await initRecords(git.root, config(test), (await git.head()).slice(0, 7));
  await sh(git.root, ["add", "-A"]);
  await sh(git.root, ["commit", "-q", "-m", "records: init"]);
  const tree = join(git.root, ".temp", "worktrees", "data");
  await sh(git.root, ["worktree", "add", "-q", tree, "-b", "track/data", "main"]);
  const message = join(git.root, ".temp", "message.txt");
  await writeFile(message, "feat(data): the task\n\nwhy it is so\n");
  const ran: string[][] = [];
  const deps: LandDeps = {
    runTests: async (cwd, command, env) => {
      ran.push([cwd, ...command, env["TALLY_TEST_MARK"] ?? "", env["CARGO_TARGET_DIR"] ?? "unset", env["TMPDIR"] ?? ""]);
      if (command[0] === "false") throw new Error("tests failed");
    },
    log: () => undefined,
  };
  return { repo: await openRepo(git.root), root: git.root, tree, message, ran, deps };
}

async function edit(tree: string, file: string, content = "x\n"): Promise<void> {
  await mkdir(join(tree, file, ".."), { recursive: true });
  await writeFile(join(tree, file), content);
}

describe("the landing's refusals", () => {
  test("a file must be relative to the worktree", async () => {
    const f = await fixture();
    await expect(landTrack(f.repo, { track: "data", files: ["/etc/x"], messageFile: f.message }, f.deps)).rejects.toThrow("file must be relative to the worktree: /etc/x");
    await expect(landTrack(f.repo, { track: "data", files: ["../x"], messageFile: f.message }, f.deps)).rejects.toThrow("file must be relative to the worktree: ../x");
  });

  test("a new commit needs both the message and explicit files", async () => {
    const f = await fixture();
    await expect(landTrack(f.repo, { track: "data", files: ["a"] }, f.deps)).rejects.toThrow("a new commit needs both --message and explicit files");
    await expect(landTrack(f.repo, { track: "data", files: [], messageFile: f.message }, f.deps)).rejects.toThrow("a new commit needs both --message and explicit files");
  });

  test("a verified-code landing may carry documentation only", async () => {
    const f = await fixture();
    await expect(landTrack(f.repo, { track: "data", files: ["src/x.rs"], messageFile: f.message, verifiedCode: "abc1234" }, f.deps))
      .rejects.toThrow("--verified-code is only for documentation/evidence on already checked code");
  });

  test("the operator checkout must be on main and clean outside the records", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "stray.txt"), "x");
    await expect(landTrack(f.repo, { track: "data", files: [] }, f.deps)).rejects.toThrow("operator checkout has changes; left untouched");
    await sh(f.root, ["checkout", "-q", "-b", "elsewhere"]);
    await expect(landTrack(f.repo, { track: "data", files: [] }, f.deps)).rejects.toThrow("operator checkout is not on main");
  });

  test("a change under the records folder does not count as a dirty checkout", async () => {
    const f = await fixture();
    await writeFile(join(f.root, "docs", "records", "ledger.json"), "{}");
    await edit(f.tree, "src/new.rs");
    await landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps);
    expect(await sh(f.root, ["log", "-1", "--format=%s"])).toBe("feat(data): the task");
  });

  test("the worktree must be on its track's branch", async () => {
    const f = await fixture();
    await sh(f.tree, ["checkout", "-q", "-b", "track/other"]);
    await expect(landTrack(f.repo, { track: "data", files: [] }, f.deps)).rejects.toThrow("worktree is not on its track branch");
  });

  test("unrelated staged files and uncommitted work without a message are refused", async () => {
    const f = await fixture();
    await edit(f.tree, "src/a.rs");
    await edit(f.tree, "src/b.rs");
    await sh(f.tree, ["add", "src/b.rs"]);
    await expect(landTrack(f.repo, { track: "data", files: ["src/a.rs"], messageFile: f.message }, f.deps)).rejects.toThrow("unrelated staged files; left untouched");
    await sh(f.tree, ["reset", "-q"]);
    await expect(landTrack(f.repo, { track: "data", files: [] }, f.deps)).rejects.toThrow("commit the task with --message and explicit files");
  });

  test("failing tests stop the landing before any commit", async () => {
    const f = await fixture(["false"]);
    await edit(f.tree, "src/new.rs");
    const main = await sh(f.root, ["rev-parse", "main"]);
    await expect(landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps)).rejects.toThrow("tests failed");
    expect(await sh(f.root, ["rev-parse", "main"])).toBe(main);
    expect(await sh(f.tree, ["status", "--porcelain"])).toContain("src/new.rs");
  });

  test("main moving inside the landing is refused and the task preserved", async () => {
    const f = await fixture();
    await edit(f.tree, "src/new.rs");
    const deps: LandDeps = { ...f.deps, afterTests: async () => { await sh(f.root, ["commit", "-q", "--allow-empty", "-m", "someone else"]); } };
    await expect(landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, deps)).rejects.toThrow("main moved outside the landing lock; task preserved, retry");
    expect(await sh(f.tree, ["log", "-1", "--format=%s"])).toBe("feat(data): the task");
  });
});

describe("a landing", () => {
  test("rebases, tests in the worktree with the configured environment, commits as the operator and fast-forwards main", async () => {
    const f = await fixture();
    await edit(f.tree, "src/new.rs");
    const result = await landTrack(f.repo, { track: "data", files: ["src/new.rs"], messageFile: f.message }, f.deps);
    expect(result.head).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(f.root, ["rev-parse", "main"])).toBe(await sh(f.tree, ["rev-parse", "HEAD"]));
    expect(await sh(f.root, ["log", "-1", "--format=%an <%ae>|%cn|%B"])).toBe("operator <operator@example.com>|operator|feat(data): the task\n\nwhy it is so");
    expect(f.ran).toEqual([[f.tree, "true", "1", "unset", join(f.tree, ".temp", "data", "tmp")]]);
    expect(await sh(f.tree, ["status", "--porcelain"])).toBe("");
  });

  test("lands committed work with no new commit, and reuses a verification whose fingerprint still holds", async () => {
    const f = await fixture();
    await edit(f.tree, "docs/note.md", "# note\n");
    await sh(f.tree, ["add", "docs/note.md"]);
    await sh(f.tree, ["commit", "-q", "-m", "docs: note"]);
    const fingerprint = await sh(f.root, ["log", "-1", "--format=%h", "--", "src", "Cargo.toml", ":(exclude)*.md"]);
    await landTrack(f.repo, { track: "data", files: [], verifiedCode: fingerprint }, f.deps);
    expect(f.ran).toEqual([]);
    expect(await sh(f.root, ["log", "-1", "--format=%s"])).toBe("docs: note");
    await edit(f.tree, "docs/two.md", "# two\n");
    await expect(landTrack(f.repo, { track: "data", files: ["docs/two.md"], messageFile: f.message, verifiedCode: "0000000" }, f.deps))
      .rejects.toThrow("main code differs from the verification; task preserved, recheck changed code");
  });
});
