import { lstat, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { worktrees } from "../../src/git/refs.ts";
import { landingCheckoutPath, moveLandingCheckout, openLandingCheckout } from "../../src/land/checkout.ts";
import { branches } from "../../src/status/tracks.ts";
import { makeRepo, sh } from "../support/repo.ts";

async function fixture(ignored = "deps/\n") {
  const git = await makeRepo();
  await git.commit(".gitignore", `.temp/\n${ignored}`, "chore: ignore");
  await git.commit("src/lib.rs", "fn a() {}\n", "feat: a");
  const tree = join(git.root, ".temp", "worktrees", "data");
  await sh(git.root, ["worktree", "add", "-q", tree, "-b", "track/data", "main"]);
  return { ...git, tree, checkout: landingCheckoutPath(tree, "data"), head: await git.head() };
}

const exists = (path: string): Promise<boolean> => lstat(path).then(() => true, () => false);

describe("the landing checkout", () => {
  test("lies in the track's folder of its worktree", () => {
    expect(landingCheckoutPath("/repo/tree", "data")).toBe(join("/repo/tree", ".temp", "data", "landing"));
  });

  test("is made detached on first use and kept afterwards", async () => {
    const f = await fixture();

    const path = await openLandingCheckout(f.tree, "data");
    await writeFile(join(path, "left-behind"), "x");
    const again = await openLandingCheckout(f.tree, "data");

    expect(path).toBe(f.checkout);
    expect(again).toBe(f.checkout);
    expect(await sh(f.checkout, ["branch", "--show-current"])).toBe("");
    expect(await exists(join(path, "left-behind"))).toBe(true);
  });

  test("stays off the board: no branch, no row, and nothing to see in the track's status", async () => {
    const f = await fixture();

    await openLandingCheckout(f.tree, "data");

    expect([...(await worktrees(f.root)).keys()].sort()).toEqual(["main", "track/data"]);
    expect((await branches(f.root, "main")).map((row) => row.branch)).toEqual(["main", "track/data"]);
    expect(await sh(f.tree, ["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
    expect(await sh(f.root, ["for-each-ref", "--format=%(refname)", "refs/heads"])).toBe("refs/heads/main\nrefs/heads/track/data");
  });

  test("is made again when its folder went but git still lists it", async () => {
    const f = await fixture();
    await openLandingCheckout(f.tree, "data");
    await rm(f.checkout, { recursive: true });

    await openLandingCheckout(f.tree, "data");

    expect(await readFile(join(f.checkout, "src", "lib.rs"), "utf8")).toBe("fn a() {}\n");
  });

  test("refuses a folder that is not a checkout, so a force never reaches the track's own worktree", async () => {
    const f = await fixture();
    await writeFile(join(f.tree, "src", "lib.rs"), "fn draft() {}\n");
    await mkdir(f.checkout, { recursive: true });
    await writeFile(join(f.checkout, "notes.txt"), "mine");

    await expect(openLandingCheckout(f.tree, "data")).rejects.toThrow("already exists");

    expect(await readFile(join(f.tree, "src", "lib.rs"), "utf8")).toBe("fn draft() {}\n");
    expect(await readFile(join(f.checkout, "notes.txt"), "utf8")).toBe("mine");
  });

  test("moves to a commit, throwing away what a run left and keeping what is ignored", async () => {
    const f = await fixture();
    const later = await f.commit("src/later.rs", "fn b() {}\n", "feat: b");
    const path = await openLandingCheckout(f.tree, "data");
    await moveLandingCheckout(path, later, f.tree, []);
    await writeFile(join(path, "src", "lib.rs"), "changed by a run\n");
    await mkdir(join(path, "junk"));
    await writeFile(join(path, "junk", "file"), "x");
    await mkdir(join(path, "deps"));
    await writeFile(join(path, "deps", "cache"), "warm");

    await moveLandingCheckout(path, f.head, f.tree, []);

    expect(await sh(path, ["rev-parse", "HEAD"])).toBe(f.head);
    expect(await sh(path, ["branch", "--show-current"])).toBe("");
    expect(await readFile(join(path, "src", "lib.rs"), "utf8")).toBe("fn a() {}\n");
    expect(await exists(join(path, "src", "later.rs"))).toBe(false);
    expect(await exists(join(path, "junk"))).toBe(false);
    expect(await readFile(join(path, "deps", "cache"), "utf8")).toBe("warm");
  });
});

describe("a landing link", () => {
  test("points at the worktree's folder, and a clean takes the link and never what it points at", async () => {
    const f = await fixture();
    await mkdir(join(f.tree, "deps"));
    await writeFile(join(f.tree, "deps", "tool"), "kept");
    const path = await openLandingCheckout(f.tree, "data");

    await moveLandingCheckout(path, f.head, f.tree, ["deps"]);
    await moveLandingCheckout(path, f.head, f.tree, ["deps"]);

    expect(await readlink(join(path, "deps"))).toBe(join(f.tree, "deps"));
    expect(await readFile(join(path, "deps", "tool"), "utf8")).toBe("kept");
    expect(await readFile(join(f.tree, "deps", "tool"), "utf8")).toBe("kept");
  });

  test("is laid again when the clean leaves it, because git ignores it", async () => {
    const f = await fixture("deps\n");
    await mkdir(join(f.tree, "deps"));
    const path = await openLandingCheckout(f.tree, "data");

    await moveLandingCheckout(path, f.head, f.tree, ["deps/"]);
    await moveLandingCheckout(path, f.head, f.tree, ["deps/"]);

    expect(await readlink(join(path, "deps"))).toBe(join(f.tree, "deps"));
  });

  test("makes the folders above it in a commit that does not have them, and a clean of those folders spares what it points at", async () => {
    const f = await fixture();
    await mkdir(join(f.tree, "ui", "deps"), { recursive: true });
    await writeFile(join(f.tree, "ui", "deps", "tool"), "kept");
    const path = await openLandingCheckout(f.tree, "data");

    await moveLandingCheckout(path, f.head, f.tree, ["ui/deps"]);
    await moveLandingCheckout(path, f.head, f.tree, []);

    expect(await exists(join(path, "ui"))).toBe(false);
    expect(await readFile(join(f.tree, "ui", "deps", "tool"), "utf8")).toBe("kept");
  });

  test("refuses what the worktree does not have", async () => {
    const f = await fixture();
    const path = await openLandingCheckout(f.tree, "data");

    await expect(moveLandingCheckout(path, f.head, f.tree, ["deps"])).rejects.toThrow("the landing cannot link deps: the worktree has none");
  });

  test("refuses to hide a path the commit carries, since the tests would not see what lands", async () => {
    const f = await fixture();
    const path = await openLandingCheckout(f.tree, "data");

    await expect(moveLandingCheckout(path, f.head, f.tree, ["src"])).rejects.toThrow("the landing cannot link src: the checkout has its own");

    expect(await readFile(join(path, "src", "lib.rs"), "utf8")).toBe("fn a() {}\n");
  });
});
