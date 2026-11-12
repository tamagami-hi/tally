import { mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { rootOfWorktree } from "../../src/repos/find.ts";
import { findRepo, openAt } from "../../src/repos/lookup.ts";
import { addRepo } from "../../src/repos/list.ts";
import { sh } from "../support/repo.ts";
import { tmpDir } from "../support/tmp.ts";
import { makeTracked } from "../support/tracked.ts";

describe("the repository a folder belongs to", () => {
  test("is the folder itself for the repository's own checkout", async () => {
    const { root } = await makeTracked();

    expect(await rootOfWorktree(root)).toBe(root);
  });

  test("is the repository's root for a track's worktree", async () => {
    const { root, trees } = await makeTracked();

    expect(await rootOfWorktree(trees["data"] ?? "")).toBe(root);
  });

  test("is the repository's root for a folder inside a worktree", async () => {
    const { root, trees } = await makeTracked();
    const inside = join(trees["engine"] ?? "", "src", "deep");
    await mkdir(inside, { recursive: true });

    expect(await rootOfWorktree(inside)).toBe(root);
  });

  test("is found through a link to the worktree", async () => {
    const { root, trees } = await makeTracked();
    const link = join(await tmpDir("tally-link-"), "linked");
    await symlink(trees["data"] ?? "", link);

    expect(await rootOfWorktree(link)).toBe(root);
  });

  test("is refused for a folder that does not exist", async () => {
    await expect(rootOfWorktree("/no/such/folder")).rejects.toThrow("/no/such/folder does not exist");
  });

  test("is refused for a folder outside any git repository", async () => {
    const folder = await tmpDir("tally-plain-");

    await expect(rootOfWorktree(folder)).rejects.toThrow(`${folder} is not inside a git repository`);
  });

  test("is refused for a bare repository", async () => {
    const bare = await tmpDir("tally-bare-");
    await sh(bare, ["init", "-q", "--bare"]);

    await expect(rootOfWorktree(bare)).rejects.toThrow("has no checkout of its own");
  });
});

describe("finding a listed repository", () => {
  test("answers its entry from a track's worktree", async () => {
    const home = await tmpDir("tally-home-");
    const { root, trees } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });

    const entry = await findRepo(home, trees["data"] ?? "");

    expect(entry.name).toBe("alpha");
    expect(entry.root).toBe(root);
  });

  test("tells two repositories apart by their worktrees", async () => {
    const home = await tmpDir("tally-home-");
    const first = await makeTracked();
    const second = await makeTracked();
    await addRepo(home, { root: first.root, name: "alpha" });
    await addRepo(home, { root: second.root, name: "beta" });

    expect((await findRepo(home, first.trees["engine"] ?? "")).name).toBe("alpha");
    expect((await findRepo(home, second.trees["engine"] ?? "")).name).toBe("beta");
  });

  test("quotes a path with spaces in the command it suggests", async () => {
    const home = await tmpDir("tally-home-");
    const root = join(await tmpDir("tally-spaced-"), "my repo");
    await mkdir(root, { recursive: true });
    await sh(root, ["init", "-q", "-b", "main"]);

    await expect(findRepo(home, root)).rejects.toThrow(`tally repo add '${root}'`);
  });

  test("refuses a repository that is not listed, and says how to list it", async () => {
    const home = await tmpDir("tally-home-");
    const { root, trees } = await makeTracked();

    await expect(findRepo(home, trees["data"] ?? "")).rejects.toThrow(`${root} is not a repository tally tracks; add it in the sidebar, or with: tally repo add ${root}`);
  });
});

describe("opening a repository by its root", () => {
  test("gives a listed repository the state the list gives it", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });

    const repo = await openAt(home, root);

    expect(repo.name).toBe("alpha");
    expect(repo.stateDir).toBe(join(home, "state/alpha"));
  });

  test("leaves an unlisted repository's state where it is today", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();

    expect((await openAt(home, root)).stateDir).toBe(join(root, ".temp/tally/state"));
  });
});

describe("opening a listed repository from one of its worktrees", () => {
  test("opens the repository itself, with the state the list gives it", async () => {
    const home = await tmpDir("tally-home-");
    const { root, trees } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });

    const repo = await openAt(home, trees["data"] ?? "");

    expect(repo.root).toBe(root);
    expect(repo.stateDir).toBe(join(home, "state/alpha"));
  });
});
