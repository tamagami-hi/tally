import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { listPath, stateDirOf, tallyHome } from "../../src/repos/home.ts";
import { addRepo, readRepoList, removeRepo, setDefaultRepo } from "../../src/repos/list.ts";
import { nameFromFolder } from "../../src/repos/name.ts";
import { openSession } from "../../src/state/sessions.ts";
import { openRepo } from "../../src/store/records.ts";
import { makeRepo, sh } from "../support/repo.ts";
import { tmpDir } from "../support/tmp.ts";
import { makeTracked, trackedConfig } from "../support/tracked.ts";

const NOW = new Date("2026-11-12T10:00:00.000Z");

describe("the home folder", () => {
  test("is TALLY_HOME when it is set", () => {
    expect(tallyHome({ TALLY_HOME: "/data" })).toBe("/data");
  });

  test("falls back to the user's state folder", () => {
    expect(tallyHome({ HOME: "/home/someone" })).toBe("/home/someone/.local/state/tally");
  });

  test("is made absolute, so every process agrees on it", () => {
    expect(tallyHome({ TALLY_HOME: "data" })).toBe(join(process.cwd(), "data"));
  });

  test("ignores an empty HOME", () => {
    expect(tallyHome({ HOME: "" })).toBe(join(homedir(), ".local/state/tally"));
  });

  test("keeps the list and each repository's state under it", () => {
    expect(listPath("/data")).toBe("/data/repos.json");
    expect(stateDirOf("/data", "alpha")).toBe("/data/state/alpha");
  });
});

describe("a name from a folder", () => {
  test("is lowercase, with other characters turned into dashes", () => {
    expect(nameFromFolder("/work/My Repo.v2")).toBe("my-repo-v2");
  });

  test("never starts with a dash", () => {
    expect(nameFromFolder("/work/.hidden")).toBe("hidden");
  });
});

describe("adding a repository", () => {
  test("lists it under the given name and makes the first one the default", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();

    const entry = await addRepo(home, { root, name: "alpha" }, NOW);

    expect(entry).toEqual({ name: "alpha", root, addedAt: NOW.toISOString() });
    expect(await readRepoList(home)).toEqual({ schema: 1, default: "alpha", repos: [entry] });
    expect(JSON.parse(await readFile(listPath(home), "utf8"))).toEqual({ schema: 1, default: "alpha", repos: [entry] });
  });

  test("names it after its folder when no name is given", async () => {
    const home = await tmpDir("tally-home-");
    const root = join(await tmpDir("tally-named-"), "My Project");
    await mkdir(join(root, "docs/records"), { recursive: true });
    await sh(root, ["init", "-q", "-b", "main"]);
    await writeFile(join(root, "docs/records/config.json"), JSON.stringify({ ...trackedConfig, tracks: [] }));

    const entry = await addRepo(home, { root }, NOW);

    expect(entry.name).toBe("my-project");
  });

  test("says what git said when git cannot read the folder", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await writeFile(join(root, ".git/config"), "this is not a git config\n");

    await expect(addRepo(home, { root, name: "alpha" })).rejects.toThrow(/git could not read .*bad config/s);
  });

  test("keeps the first default when a second repository is added", async () => {
    const home = await tmpDir("tally-home-");
    const first = await makeTracked();
    const second = await makeTracked();

    await addRepo(home, { root: first.root, name: "alpha" }, NOW);
    await addRepo(home, { root: second.root, name: "beta" }, NOW);

    const list = await readRepoList(home);
    expect(list.default).toBe("alpha");
    expect(list.repos.map((repo) => repo.name)).toEqual(["alpha", "beta"]);
  });

  test("keeps both when two are added at the same moment", async () => {
    const home = await tmpDir("tally-home-");
    const first = await makeTracked();
    const second = await makeTracked();

    await Promise.all([addRepo(home, { root: first.root, name: "alpha" }, NOW), addRepo(home, { root: second.root, name: "beta" }, NOW)]);

    expect((await readRepoList(home)).repos.map((repo) => repo.name).sort()).toEqual(["alpha", "beta"]);
  });

  test("stores the real path when the folder is reached through a link", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    const link = join(await tmpDir("tally-link-"), "linked");
    await symlink(root, link);

    const entry = await addRepo(home, { root: link, name: "alpha" }, NOW);

    expect(entry.root).toBe(root);
  });

  test("refuses a folder that does not exist", async () => {
    const home = await tmpDir("tally-home-");

    await expect(addRepo(home, { root: "/no/such/folder", name: "alpha" })).rejects.toThrow("/no/such/folder does not exist");
  });

  test("refuses a folder that is not a git repository", async () => {
    const home = await tmpDir("tally-home-");
    const folder = await tmpDir("tally-plain-");

    await expect(addRepo(home, { root: folder, name: "alpha" })).rejects.toThrow("is not a git repository");
  });

  test("refuses a folder inside a repository, naming its top", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await mkdir(join(root, "src"), { recursive: true });

    await expect(addRepo(home, { root: join(root, "src"), name: "alpha" })).rejects.toThrow(`is inside the repository ${root}; add that folder`);
  });

  test("refuses a linked worktree, naming the repository it belongs to", async () => {
    const home = await tmpDir("tally-home-");
    const { root, trees } = await makeTracked();

    await expect(addRepo(home, { root: trees["data"] ?? "", name: "alpha" })).rejects.toThrow(`is a linked worktree of ${root}; add that repository`);
  });

  test("refuses a bare repository", async () => {
    const home = await tmpDir("tally-home-");
    const bare = await tmpDir("tally-bare-");
    await sh(bare, ["init", "-q", "--bare"]);

    await expect(addRepo(home, { root: bare, name: "alpha" })).rejects.toThrow("has no checkout of its own");
  });

  test("refuses a repository with no records config", async () => {
    const home = await tmpDir("tally-home-");
    const git = await makeRepo();

    await expect(addRepo(home, { root: git.root, name: "alpha" })).rejects.toThrow(`${git.root} has no docs/records/config.json`);
  });

  test("refuses a config that does not fit its schema", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await writeFile(join(root, "docs/records/config.json"), JSON.stringify({ schema: 1, name: "Broken" }));

    await expect(addRepo(home, { root, name: "alpha" })).rejects.toThrow("does not fit its schema");
  });

  test("refuses a repository whose git filter names a program that is not here", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await writeFile(join(root, ".gitattributes"), "*.bin filter=special\n");
    await sh(root, ["add", ".gitattributes"]);
    await sh(root, ["commit", "-q", "-m", "chore: a filter"]);
    await sh(root, ["config", "filter.special.clean", "no-such-tool-anywhere --clean"]);

    await expect(addRepo(home, { root, name: "alpha" })).rejects.toThrow(`${root} uses the git filter 'special', whose program no-such-tool-anywhere is not available here; install it, or the files it filters would be committed wrongly`);
  });

  test("accepts a repository whose git filter's program is here", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await writeFile(join(root, ".gitattributes"), "*.txt filter=plain\n");
    await sh(root, ["add", ".gitattributes"]);
    await sh(root, ["commit", "-q", "-m", "chore: a filter"]);
    await sh(root, ["config", "filter.plain.clean", "cat"]);

    await expect(addRepo(home, { root, name: "alpha" })).resolves.toMatchObject({ name: "alpha" });
  });

  test.each(["Alpha", "my repo", "-alpha", "a/b", ""])("refuses the name '%s'", async (name) => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();

    await expect(addRepo(home, { root, name })).rejects.toThrow("a repository's name is lowercase letters, digits, - and _");
  });

  test("refuses a name that is already listed", async () => {
    const home = await tmpDir("tally-home-");
    const first = await makeTracked();
    const second = await makeTracked();
    await addRepo(home, { root: first.root, name: "alpha" });

    await expect(addRepo(home, { root: second.root, name: "alpha" })).rejects.toThrow(`the name alpha is taken by ${first.root}`);
  });

  test("refuses a repository that is already listed", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });

    await expect(addRepo(home, { root, name: "beta" })).rejects.toThrow(`${root} is already listed as alpha`);
  });
});

describe("a repository that was served on its own before", () => {
  test("is not listed while sessions are open under its old state folder", async () => {
    const home = await tmpDir("tally-home-");
    const { repo, root, trees } = await makeTracked();
    await openSession(repo, { worktree: trees["data"] ?? "", track: "data", agent: "claude" });

    await expect(addRepo(home, { root, name: "alpha" })).rejects.toThrow(`${root} has 1 open session under ${join(root, ".temp/tally/state")}; close it before listing the repository`);
  });
});

describe("removing a repository", () => {
  test("takes it off the list and leaves its records alone", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await addRepo(home, { root, name: "alpha" }, NOW);

    const removed = await removeRepo(home, "alpha");

    expect(removed.root).toBe(root);
    expect(await readRepoList(home)).toEqual({ schema: 1, repos: [] });
    expect((await openRepo(root)).config.name).toBe("Test");
  });

  test("passes the default to the next repository", async () => {
    const home = await tmpDir("tally-home-");
    const first = await makeTracked();
    const second = await makeTracked();
    await addRepo(home, { root: first.root, name: "alpha" });
    await addRepo(home, { root: second.root, name: "beta" });

    await removeRepo(home, "alpha");

    expect((await readRepoList(home)).default).toBe("beta");
  });

  test("is refused while a session is open in it", async () => {
    const home = await tmpDir("tally-home-");
    const { root, trees } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });
    const listed = await openRepo(root, { name: "alpha", stateDir: stateDirOf(home, "alpha") });
    await openSession(listed, { worktree: trees["data"] ?? "", track: "data", agent: "claude" });

    await expect(removeRepo(home, "alpha")).rejects.toThrow("alpha has 1 open session; close it first");
    expect((await readRepoList(home)).repos).toHaveLength(1);
  });

  test("refuses a name that is not listed", async () => {
    const home = await tmpDir("tally-home-");

    await expect(removeRepo(home, "ghost")).rejects.toThrow("no repository 'ghost'");
  });
});

describe("a name that is used again", () => {
  test("gets its state back when the same repository returns", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });
    await removeRepo(home, "alpha");

    await expect(addRepo(home, { root, name: "alpha" })).resolves.toMatchObject({ name: "alpha", root });
  });

  test("is refused for another repository while the first one's state is there", async () => {
    const home = await tmpDir("tally-home-");
    const first = await makeTracked();
    const second = await makeTracked();
    await addRepo(home, { root: first.root, name: "alpha" });
    await removeRepo(home, "alpha");

    await expect(addRepo(home, { root: second.root, name: "alpha" })).rejects.toThrow(`the name alpha still holds the state of ${first.root}; pick another name`);
    expect((await readRepoList(home)).repos).toHaveLength(0);
  });
});

describe("a list written by hand", () => {
  test.each([
    ["two entries with one name", { schema: 1, repos: [{ name: "a", root: "/x", addedAt: "t" }, { name: "a", root: "/y", addedAt: "t" }] }, "the name a is listed twice"],
    ["two entries with one root", { schema: 1, repos: [{ name: "a", root: "/x", addedAt: "t" }, { name: "b", root: "/x", addedAt: "t" }] }, "/x is listed twice"],
    ["a default that is not listed", { schema: 1, default: "ghost", repos: [] }, "the default ghost is not listed"],
  ])("is refused with %s", async (_, list, message) => {
    const home = await tmpDir("tally-home-");
    await writeFile(listPath(home), JSON.stringify(list));

    await expect(readRepoList(home)).rejects.toThrow(message);
  });
});

describe("the default repository", () => {
  test("can be set to another listed repository", async () => {
    const home = await tmpDir("tally-home-");
    const first = await makeTracked();
    const second = await makeTracked();
    await addRepo(home, { root: first.root, name: "alpha" });
    await addRepo(home, { root: second.root, name: "beta" });

    await setDefaultRepo(home, "beta");

    expect((await readRepoList(home)).default).toBe("beta");
  });

  test("cannot be a repository that is not listed", async () => {
    const home = await tmpDir("tally-home-");
    const { root } = await makeTracked();
    await addRepo(home, { root, name: "alpha" });

    await expect(setDefaultRepo(home, "ghost")).rejects.toThrow("no repository 'ghost'; listed: alpha");
  });
});
