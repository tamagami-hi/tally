import { access, constants, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RUNNER } from "../../src/land/runner.ts";
import { openSession } from "../../src/state/sessions.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { opening } from "../support/opening.ts";
import { sh } from "../support/repo.ts";

const NOW = new Date("2026-11-12T10:00:00.000Z");
const helper = { name: "helper", purpose: "split the reader" };

const recorded = async (root: string): Promise<unknown> => JSON.parse(await readFile(join(root, "docs/records/tracks.json"), "utf8"));

describe("opening a track", () => {
  test("makes the branch at main's tip, the worktree and its runner, and records who opened it and why", async () => {
    const { repo, root, operator, fresh } = await opening();

    const opened = await openTrack(repo, operator, helper, NOW);

    const tree = join(root, ".temp/worktrees/helper");
    expect(opened.track).toEqual({ name: "helper", branch: "track/helper", worktree: tree, purpose: "split the reader", openedBy: { track: "main", agent: "operator" }, openedAt: NOW.toISOString() });
    expect(opened.runner).toBe(join(tree, RUNNER));
    expect(await sh(root, ["rev-parse", "track/helper"])).toBe(await sh(root, ["rev-parse", "main"]));
    expect(await sh(tree, ["branch", "--show-current"])).toBe("track/helper");
    await expect(access(opened.runner, constants.X_OK)).resolves.toBeUndefined();
    expect(await recorded(root)).toEqual({ schema: 1, tracks: [{ ...opened.track, worktree: ".temp/worktrees/helper" }] });
    expect((await fresh()).config.tracks.map((track) => track.name)).toEqual(["data", "engine", "helper"]);
  });

  test("makes the track's scratch folder, .temp/<name> in its worktree, and answers where it is", async () => {
    const { repo, operator } = await opening();

    const opened = await openTrack(repo, operator, helper, NOW);

    expect(opened.scratch).toBe(join(opened.track.worktree, ".temp", "helper"));
    expect((await stat(opened.scratch)).isDirectory()).toBe(true);
  });

  test("gives a track a session can open on at once", async () => {
    const { repo, operator, fresh } = await opening();
    const opened = await openTrack(repo, operator, helper);

    const session = await openSession(await fresh(), { worktree: opened.track.worktree, agent: "claude" });

    expect(session).toMatchObject({ track: "helper", branch: "track/helper" });
  });

  test("a track's session opens a child of its own track without naming the parent", async () => {
    const { repo, data, fresh } = await opening();

    const opened = await openTrack(repo, data, helper);

    expect(opened.track.parent).toBe("data");
    expect(opened.track.openedBy).toEqual({ track: "data", agent: "claude" });
    expect((await fresh()).config.tracks.at(-1)?.parent).toBe("data");
  });

  test("a track's session may not open a child of another track", async () => {
    const { repo, data } = await opening();

    await expect(openTrack(repo, data, { ...helper, parent: "engine" })).rejects.toThrow(`session ${data.id} is bound to track data and may open only a child of data, not of engine`);
  });

  test("an operator session opens a track with or without a parent", async () => {
    const { repo, operator } = await opening();

    const child = await openTrack(repo, operator, { ...helper, parent: "engine" });
    const alone = await openTrack(repo, operator, { name: "docs", purpose: "the guide" });

    expect(child.track.parent).toBe("engine");
    expect(alone.track.parent).toBeUndefined();
  });

  test("keeps the paths the track may land, and refuses one that leaves the worktree", async () => {
    const { repo, operator, fresh } = await opening();

    await expect(openTrack(repo, operator, { ...helper, paths: ["../other"] })).rejects.toThrow("a track's paths are relative to its worktree: ../other");
    const opened = await openTrack(repo, operator, { ...helper, paths: ["src/reader"] });

    expect(opened.track.paths).toEqual(["src/reader"]);
    expect((await fresh()).config.tracks.at(-1)?.paths).toEqual(["src/reader"]);
  });

  test("puts the worktree under the config's worktreeRoot", async () => {
    const { repo, root, operator } = await opening();

    const inside = await openTrack({ ...repo, config: { ...repo.config, worktreeRoot: ".temp/trees" } }, operator, helper);

    expect(inside.track.worktree).toBe(join(root, ".temp/trees/helper"));
    expect(await sh(inside.track.worktree, ["branch", "--show-current"])).toBe("track/helper");
  });

  test("keeps a child inside its parent's paths: it takes them when it names none, and may not go wider", async () => {
    const { repo, operator, fresh } = await opening();
    const reader = await openTrack(repo, operator, { name: "reader", purpose: "the reader", paths: ["src/reader"] });
    const parent = await openSession(await fresh(), { worktree: reader.track.worktree, agent: "claude" });

    const inherits = await openTrack(await fresh(), parent, { name: "reader-a", purpose: "the first half" });
    const narrower = await openTrack(await fresh(), parent, { name: "reader-b", purpose: "the index", paths: ["src/reader/index"] });

    expect(inherits.track.paths).toEqual(["src/reader"]);
    expect(narrower.track.paths).toEqual(["src/reader/index"]);
    await expect(openTrack(await fresh(), parent, { name: "reader-c", purpose: "elsewhere", paths: ["src/writer"] })).rejects.toThrow("track reader may land only src/reader, so its child reader-c cannot land src/writer");
  });

  test("leaves no branch and no folder behind when the opening fails half way", async () => {
    const { repo, root, operator } = await opening();
    const broken = { ...repo, config: { ...repo.config, commands: { ...repo.config.commands, env: { "NOT A NAME": "x" } } } };

    await expect(openTrack(broken, operator, helper)).rejects.toThrow("the config names an environment variable a shell cannot set");

    expect(await sh(root, ["branch", "--list", "track/helper"])).toBe("");
    expect(await stat(join(root, ".temp/worktrees/helper")).then(() => true, () => false)).toBe(false);
    expect((await openTrack(repo, operator, helper)).track.name).toBe("helper");
  });

  test("commits the record as the other records are committed", async () => {
    const { repo, root, operator } = await opening({ commit: true });

    const opened = await openTrack(repo, operator, helper);

    expect(opened.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toBe("records: track helper opened by operator");
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });
});

describe("a track that cannot be opened", () => {
  test("has a name outside the naming rule, or no purpose", async () => {
    const { repo, operator } = await opening();

    await expect(openTrack(repo, operator, { ...helper, name: "My Helper" })).rejects.toThrow("a track's name is lowercase letters, digits, - and _, and starts with a letter or a digit: 'My Helper'");
    await expect(openTrack(repo, operator, { ...helper, name: "../up" })).rejects.toThrow("a track's name is");
    await expect(openTrack(repo, operator, { ...helper, purpose: "  " })).rejects.toThrow("a track needs a purpose: say in a line what it is for");
  });

  test("has a name that is taken by the config, by an opened track or by the main branch", async () => {
    const { repo, operator } = await opening();
    await openTrack(repo, operator, helper);

    await expect(openTrack(repo, operator, { ...helper, name: "data" })).rejects.toThrow("the name data is taken; the tracks are data, engine, helper");
    await expect(openTrack(repo, operator, helper)).rejects.toThrow("the name helper is taken; the tracks are data, engine, helper");
    await expect(openTrack(repo, operator, { ...helper, name: "main" })).rejects.toThrow("the name main is the main branch's");
  });

  test("names a parent that is not a track", async () => {
    const { repo, root, operator } = await opening();

    await expect(openTrack(repo, operator, { ...helper, parent: "nobody" })).rejects.toThrow("no track 'nobody' to be the parent of helper; the tracks are data, engine");
    expect(await sh(root, ["branch", "--list", "track/helper"])).toBe("");
  });

  test("would take a branch that already exists", async () => {
    const { repo, root, operator } = await opening();
    await sh(root, ["branch", "track/helper", "main"]);

    await expect(openTrack(repo, operator, helper)).rejects.toThrow("the branch track/helper already exists; delete it, or pick another name");
  });

  test("would take a folder that already exists, and leaves no branch behind", async () => {
    const { repo, root, operator } = await opening();
    const tree = join(root, ".temp/worktrees/helper");
    await mkdir(tree, { recursive: true });
    await writeFile(join(tree, "notes.txt"), "mine\n");

    await expect(openTrack(repo, operator, helper)).rejects.toThrow(`${tree} already exists; move it away, or pick another name`);
    expect(await sh(root, ["branch", "--list", "track/helper"])).toBe("");
    expect(await readFile(join(tree, "notes.txt"), "utf8")).toBe("mine\n");
  });
});
