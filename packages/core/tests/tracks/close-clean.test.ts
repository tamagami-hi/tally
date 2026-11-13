import { appendFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openLandingCheckout } from "../../src/land/checkout.ts";
import { closeSession, openSession } from "../../src/state/sessions.ts";
import { closeTrack } from "../../src/tracks/close.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { commitOn } from "../support/landing.ts";
import { helped, isThere } from "../support/helped.ts";
import { sh } from "../support/repo.ts";
import { readRest, stampRest } from "../../src/state/rest.ts";

const NOW = new Date("2026-11-12T12:00:00.000Z");
const LATER = new Date("2026-11-12T15:30:45.000Z");

async function ignoring(root: string, ...patterns: string[]): Promise<void> {
  await appendFile(join(root, ".git", "info", "exclude"), `${patterns.join("\n")}\n`);
}

async function buildOutput(tree: string): Promise<void> {
  await mkdir(join(tree, "node_modules", "left-pad"), { recursive: true });
  await mkdir(join(tree, "dist"), { recursive: true });
  await writeFile(join(tree, "node_modules", "left-pad", "index.js"), "x");
  await writeFile(join(tree, "dist", "main.js"), "x");
  await writeFile(join(tree, "build.log"), "x");
}

describe("closing a track that holds build output", () => {
  test("deletes node_modules, dist and a log with the worktree, and names them in `cleaned`", async () => {
    const { repo, root, tree, operator } = await helped();
    await ignoring(root, "node_modules/", "dist/", "*.log");
    await buildOutput(tree);

    const closed = await closeTrack(repo, operator, "helper", NOW);

    expect(closed.cleaned).toEqual({ names: ["build.log", "dist", "node_modules"], total: 3 });
    expect(await isThere(tree)).toBe(false);
    expect(await sh(root, ["branch", "--list", "track/helper"])).toBe("");
  });

  test("names at most twenty of what it deleted, and counts them all", async () => {
    const { repo, root, tree, operator } = await helped();
    await ignoring(root, "*.cache");
    for (let index = 0; index < 25; index += 1) await writeFile(join(tree, `c${String(index).padStart(2, "0")}.cache`), "x");

    const { cleaned } = await closeTrack(repo, operator, "helper", NOW);

    expect(cleaned.total).toBe(25);
    expect(cleaned.names).toHaveLength(20);
    expect(cleaned.names[0]).toBe("c00.cache");
  });

  test("answers an empty `cleaned` and no `kept` when there was nothing to delete and no notes", async () => {
    const { repo, root, operator } = await helped();

    const closed = await closeTrack(repo, operator, "helper", NOW);

    expect(closed.cleaned).toEqual({ names: [], total: 0 });
    expect(closed.kept).toBeUndefined();
    expect(await isThere(join(root, ".temp", "closed"))).toBe(false);
  });
});

describe("closing a track that holds notes", () => {
  test("moves everything under .temp/<track>/ to .temp/closed/<track>/ of the repository, landing logs with it", async () => {
    const { repo, root, tree, operator } = await helped();
    await mkdir(join(tree, ".temp", "helper", "tally", "landings"), { recursive: true });
    await writeFile(join(tree, ".temp", "helper", "notes.md"), "what I learned\n");
    await writeFile(join(tree, ".temp", "helper", "tally", "landings", "one.log"), "ran\n");

    const closed = await closeTrack(repo, operator, "helper", NOW);

    const kept = join(root, ".temp", "closed", "helper");
    expect(closed.kept).toBe(kept);
    expect(await readFile(join(kept, "notes.md"), "utf8")).toBe("what I learned\n");
    expect(await readFile(join(kept, "tally", "landings", "one.log"), "utf8")).toBe("ran\n");
    expect(await isThere(tree)).toBe(false);
  });

  test("keeps other folders under .temp/ too, but not tally's own runner folder, nor the landing checkout", async () => {
    const { repo, root, tree, operator } = await helped();
    await mkdir(join(tree, ".temp", "plans"), { recursive: true });
    await writeFile(join(tree, ".temp", "plans", "p.md"), "plan\n");
    await openLandingCheckout(tree, "helper");

    const closed = await closeTrack(repo, operator, "helper", NOW);

    const kept = join(root, ".temp", "closed", "helper");
    expect(await readdir(kept)).toEqual(["plans"]);
    expect(closed.kept).toBe(kept);
    expect(await sh(root, ["worktree", "list", "--porcelain"])).not.toContain("helper");
  });

  test("a second track of the same name does not overwrite them: the close time joins the folder's name", async () => {
    const { repo, root, tree, operator, data, fresh } = await helped();
    await writeFile(join(tree, ".temp", "helper", "notes.md"), "first\n");
    await closeTrack(repo, operator, "helper", NOW);
    const again = await openTrack(await fresh(), data, { name: "helper", purpose: "a second pass" });
    await writeFile(join(again.track.worktree, ".temp", "helper", "notes.md"), "second\n");

    const closed = await closeTrack(await fresh(), operator, "helper", LATER);

    expect(await readFile(join(root, ".temp", "closed", "helper", "notes.md"), "utf8")).toBe("first\n");
    expect(closed.kept).toBe(join(root, ".temp", "closed", "helper-2026-11-12T15-30-45Z"));
    expect(await readFile(join(closed.kept ?? "", "notes.md"), "utf8")).toBe("second\n");
  });
});

describe("closing a track that holds work", () => {
  test("is still refused for a changed tracked file, an untracked file that is not ignored, and a commit ahead of main", async () => {
    const { repo, tree, operator } = await helped();
    await writeFile(join(tree, "RULES.md"), "# edited\n");
    await expect(closeTrack(repo, operator, "helper", NOW)).rejects.toThrow(/uncommitted work in .*RULES\.md/);
    await sh(tree, ["checkout", "--", "RULES.md"]);
    await writeFile(join(tree, "draft.rs"), "x\n");
    await expect(closeTrack(repo, operator, "helper", NOW)).rejects.toThrow(/uncommitted work in .*draft\.rs/);
    await sh(tree, ["clean", "-fdq"]);
    await commitOn(tree, "src/a.rs", "feat: a");

    await expect(closeTrack(repo, operator, "helper", NOW)).rejects.toThrow("track/helper is 1 commit ahead of main");
    expect(await isThere(tree)).toBe(true);
  });

  test("is refused while a child of the track is open, and names the child", async () => {
    const { repo, tree, operator, fresh } = await helped();
    const session = await openSession(repo, { worktree: tree, agent: "sonnet" });
    await openTrack(await fresh(), session, { name: "kid", purpose: "a part of it" });
    await closeSession(repo, session.id);

    await expect(closeTrack(await fresh(), operator, "helper", NOW)).rejects.toThrow("track helper has an open child (kid); close it first");
    expect(await isThere(tree)).toBe(true);
    await closeTrack(await fresh(), operator, "kid", NOW);
    await expect(closeTrack(await fresh(), operator, "helper", NOW)).resolves.toMatchObject({ track: { name: "helper" } });
  });
});

describe("keeping notes safely", () => {
  test("a worktree git will not remove leaves the notes where they were, and no half-kept folder behind", async () => {
    const { repo, root, tree, operator } = await helped();
    await writeFile(join(tree, ".temp", "helper", "notes.md"), "mine\n");
    await sh(root, ["worktree", "lock", tree]);

    await expect(closeTrack(repo, operator, "helper", NOW)).rejects.toThrow();

    expect(await readFile(join(tree, ".temp", "helper", "notes.md"), "utf8")).toBe("mine\n");
    expect(await readdir(join(root, ".temp", "closed"))).toEqual([]);
    expect(await sh(root, ["branch", "--list", "track/helper"])).toContain("track/helper");
  });

  test("a scratch path that is a plain file is kept too", async () => {
    const { repo, root, tree, operator } = await helped();
    await rm(join(tree, ".temp", "helper"), { recursive: true });
    await writeFile(join(tree, ".temp", "helper"), "not a folder\n");

    const closed = await closeTrack(repo, operator, "helper", NOW);

    expect(closed.kept).toBe(join(root, ".temp", "closed", "helper"));
    expect(await readFile(join(closed.kept ?? "", "helper"), "utf8")).toBe("not a folder\n");
  });

  test("forgets the track's rest time when it closes, so a track of the same name starts fresh", async () => {
    const { repo, operator } = await helped();
    await stampRest(repo, "helper", NOW);

    await closeTrack(repo, operator, "helper", NOW);

    expect(await readRest(repo, "helper")).toEqual({});
  });

  test("refuses a track named tally, whose scratch would be tally's own folder", async () => {
    const { repo, operator } = await helped();

    await expect(openTrack(repo, operator, { name: "tally", purpose: "x" })).rejects.toThrow("the name tally is tally's own folder under .temp/; pick another name");
  });
});
