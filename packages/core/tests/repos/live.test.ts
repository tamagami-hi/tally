import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { addRepo } from "../../src/repos/list.ts";
import { LiveRepo } from "../../src/repos/live.ts";
import { Repos } from "../../src/repos/repos.ts";
import { openSession } from "../../src/state/sessions.ts";
import { closeTrack } from "../../src/tracks/close.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { opening } from "../support/opening.ts";
import { tmpDir } from "../support/tmp.ts";
import { makeTracked } from "../support/tracked.ts";

const helper = { name: "helper", purpose: "split the reader" };
const names = (repo: { config: { tracks: { name: string }[] } }): string[] => repo.config.tracks.map((track) => track.name);

describe("a repository held open by one process", () => {
  test("is handed out as it was given while its config and its tracks stay as they were", async () => {
    const { repo } = await opening();
    const live = new LiveRepo(repo);

    expect(await live.current()).toBe(repo);
    expect(await live.current()).toBe(repo);
    expect(live.problem).toBeUndefined();
  });

  test("is opened again when a track is opened or closed", async () => {
    const { repo, operator } = await opening();
    const live = new LiveRepo(repo);

    await openTrack(await live.current(), operator, helper);
    const withHelper = await live.current();
    await closeTrack(withHelper, operator, "helper");

    expect(names(withHelper)).toEqual(["data", "engine", "helper"]);
    expect(names(await live.current())).toEqual(["data", "engine"]);
  });

  test("is opened again when config.json changes, and keeps its name and where its state lives", async () => {
    const { repo, root } = await opening();
    const listed = { ...repo, name: "alpha", stateDir: join(root, ".temp/elsewhere") };
    const live = new LiveRepo(listed);
    const path = join(root, "docs/records/config.json");
    const config = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;

    await writeFile(path, `${JSON.stringify({ ...config, name: "Renamed" }, null, 2)}\n`);

    expect(await live.current()).toMatchObject({ name: "alpha", stateDir: listed.stateDir, config: { name: "Renamed" } });
  });

  test("keeps the last good one when a file breaks, says why, and mends with the file", async () => {
    const { repo, root } = await opening();
    const live = new LiveRepo(repo);
    const path = join(root, "docs/records/tracks.json");

    await writeFile(path, "{ not json");
    expect(await live.current()).toBe(repo);
    expect(live.problem).toContain("tracks.json is not valid JSON");

    await writeFile(path, `${JSON.stringify({ schema: 1, tracks: [] })}\n`);
    expect(await live.current()).not.toBe(repo);
    expect(live.problem).toBeUndefined();
  });
});

describe("a listed repository whose tracks change", () => {
  test("shows a track opened in it without a new Repos, and a session opens on that track", async () => {
    const { repo, root } = await makeTracked();
    const home = await tmpDir("tally-home-");
    await addRepo(home, { root, name: "alpha" });
    const repos = new Repos(home);
    const before = await repos.get("alpha");
    const operator = await openSession(before, { worktree: root, agent: "operator" });

    const opened = await openTrack(before, operator, helper);

    const after = await repos.get("alpha");
    expect(names(before)).toEqual(names(repo));
    expect(names(after)).toEqual(["data", "engine", "helper"]);
    expect(await repos.get("alpha")).toBe(after);
    expect(await openSession(after, { worktree: opened.track.worktree, agent: "claude" })).toMatchObject({ track: "helper" });
  });

  test("keeps the last good repository when tracks.json breaks, and shows the error", async () => {
    const { root } = await makeTracked();
    const home = await tmpDir("tally-home-");
    await addRepo(home, { root, name: "alpha" });
    const repos = new Repos(home);
    await repos.get("alpha");

    await writeFile(join(root, "docs/records/tracks.json"), "{ not json");

    expect(names(await repos.get("alpha"))).toEqual(["data", "engine"]);
    expect(repos.problem("alpha")).toContain("tracks.json is not valid JSON");
  });
});
