import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { configSchema } from "../../src/schema/config.ts";
import { tracksFileSchema } from "../../src/schema/tracks.ts";
import { openRepo } from "../../src/store/records.ts";
import { makeTracked, trackedConfig } from "../support/tracked.ts";

const helper = { name: "helper", branch: "track/helper", worktree: ".temp/worktrees/helper", parent: "data", purpose: "split the reader", openedBy: { track: "data", agent: "claude" }, openedAt: "2026-11-12T10:00:00.000Z" };

async function withTracks(tracks: readonly unknown[], schema = 1): Promise<string> {
  const { root } = await makeTracked();
  await writeFile(join(root, "docs/records/tracks.json"), `${JSON.stringify({ schema, tracks }, null, 2)}\n`);
  return root;
}

const names = async (root: string): Promise<string[]> => (await openRepo(root)).config.tracks.map((track) => track.name);

describe("the config's new fields", () => {
  test("are all optional, so a config written before them reads as it did", () => {
    const config = configSchema.parse(trackedConfig);

    expect(config).toEqual(trackedConfig);
    expect(config.worktreeRoot).toBeUndefined();
    expect(config.sessions).toBeUndefined();
    expect(config.commands.checks).toBeUndefined();
  });

  test.each(["/srv/trees", "../trees", "a/../../trees", ".git/trees", ".git"])("refuse the worktree root %s, which is not a folder of the repository's own", (worktreeRoot) => {
    expect(() => configSchema.parse({ ...trackedConfig, worktreeRoot })).toThrow("worktreeRoot is a folder inside the repository");
  });

  test("keep a track's parent, the worktree root, the checks and the idle limit", () => {
    const checks = [{ name: "web", command: ["npm", "test"], paths: ["packages/web"] }];
    const config = configSchema.parse({ ...trackedConfig, worktreeRoot: "trees", sessions: { idleMinutes: 30 }, commands: { ...trackedConfig.commands, checks }, tracks: [{ name: "data", worktree: "d", branch: "track/data" }, { name: "helper", worktree: "h", branch: "track/helper", parent: "data" }] });

    expect(config.worktreeRoot).toBe("trees");
    expect(config.sessions).toEqual({ idleMinutes: 30 });
    expect(config.commands.checks).toEqual(checks);
    expect(config.tracks[1]?.parent).toBe("data");
  });

  test("refuse a check with no command or no paths, and an idle limit that is not above zero", () => {
    const withCheck = (check: unknown) => ({ ...trackedConfig, commands: { ...trackedConfig.commands, checks: [check] } });

    expect(() => configSchema.parse(withCheck({ name: "web", command: [], paths: ["src"] }))).toThrow();
    expect(() => configSchema.parse(withCheck({ name: "web", command: ["true"], paths: [] }))).toThrow();
    expect(() => configSchema.parse({ ...trackedConfig, sessions: { idleMinutes: 0 } })).toThrow();
  });
});

describe("the tracks agents opened", () => {
  test("a repository with no tracks.json has only its config's tracks", async () => {
    const { root } = await makeTracked();

    expect(await names(root)).toEqual(["data", "engine"]);
  });

  test("an open track of tracks.json is among the repository's tracks, with its parent and its paths", async () => {
    const root = await withTracks([{ ...helper, paths: ["src/reader"] }]);

    const repo = await openRepo(root);

    expect(repo.config.tracks.map((track) => track.name)).toEqual(["data", "engine", "helper"]);
    expect(repo.config.tracks.at(-1)).toEqual({ name: "helper", branch: "track/helper", worktree: ".temp/worktrees/helper", parent: "data", paths: ["src/reader"] });
  });

  test("a closed track is not", async () => {
    const root = await withTracks([{ ...helper, closedAt: "2026-11-12T11:00:00.000Z" }]);

    expect(await names(root)).toEqual(["data", "engine"]);
  });

  test("a name in both config.json and tracks.json is refused, and the refusal says where to take it out", async () => {
    const root = await withTracks([{ ...helper, name: "engine" }]);

    await expect(openRepo(root)).rejects.toThrow("track engine is in both config.json and tracks.json; a name lives in one of them, so take it out of config.json");
  });

  test("a name that is open twice in tracks.json is refused", async () => {
    const root = await withTracks([helper, helper]);

    await expect(openRepo(root)).rejects.toThrow("track helper is open twice in tracks.json");
  });

  test("a tracks.json of a schema tally does not know is refused", async () => {
    const root = await withTracks([], 2);

    await expect(openRepo(root)).rejects.toThrow(/tracks\.json does not fit its schema/);
  });

  test("the record needs a purpose and who opened it", () => {
    const { purpose: _purpose, ...unexplained } = helper;

    expect(tracksFileSchema.safeParse({ schema: 1, tracks: [unexplained] }).success).toBe(false);
    expect(tracksFileSchema.parse({ schema: 1, tracks: [helper] }).tracks).toEqual([helper]);
  });
});
