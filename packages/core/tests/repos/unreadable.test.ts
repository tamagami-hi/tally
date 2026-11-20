import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { addPhase } from "../../src/phases/add.ts";
import { phaseRows } from "../../src/phases/rows.ts";
import { addRepo } from "../../src/repos/list.ts";
import { Repos } from "../../src/repos/repos.ts";
import { collect } from "../../src/status/collect.ts";
import { openRepo, Records } from "../../src/store/records.ts";
import { openSession } from "../../src/state/sessions.ts";
import { listTracks } from "../../src/tracks/list.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { OPERATOR } from "../support/context.ts";
import { tmpDir } from "../support/tmp.ts";
import { makeTracked } from "../support/tracked.ts";

const BROKEN = "{ not json";

describe("a repository whose tracks.json does not parse", () => {
  test("opens with the config's own tracks, and names the file as its problem", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(repo.recordsDir, "tracks.json"), BROKEN);

    const opened = await openRepo(root);

    expect(opened.config.tracks.map((track) => track.name)).toEqual(["data", "engine"]);
    expect(opened.problems?.join(" ")).toMatch(/tracks\.json is not valid JSON/);
  });

  test("answers its reads, with the file among the board's problems", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(repo.recordsDir, "tracks.json"), BROKEN);
    const opened = await openRepo(root);

    const status = await collect(opened, await new Records(opened).readLedger());
    const tracks = await listTracks(opened);

    expect(status.problems.join(" ")).toMatch(/tracks\.json is not valid JSON/);
    expect(tracks.map((track) => track.name)).toEqual(["data", "engine"]);
  });

  test("refuses a write that needs the file, naming it", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(repo.recordsDir, "tracks.json"), BROKEN);
    const opened = await openRepo(root);
    const operator = await openSession(opened, { worktree: root, agent: "operator" });

    await expect(openTrack(opened, operator, { name: "docs", purpose: "the docs" })).rejects.toThrow(/tracks\.json is not valid JSON/);
  });

  test("is opened by a service that never saw it whole, with the problem named", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(repo.recordsDir, "tracks.json"), BROKEN);
    const home = await tmpDir("tally-home-");
    await addRepo(home, { root, name: "alpha" });
    const repos = new Repos(home);

    const opened = await repos.get("alpha");

    expect(opened.config.tracks.map((track) => track.name)).toEqual(["data", "engine"]);
    expect(repos.problem("alpha")).toMatch(/tracks\.json is not valid JSON/);
  });
});

describe("a repository whose phases.json does not parse", () => {
  test("opens with the config's own stages, answers its phases, and refuses to add one", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(repo.recordsDir, "phases.json"), BROKEN);

    const opened = await openRepo(root);

    expect(opened.config.stages.map((stage) => stage.id)).toEqual(["B"]);
    expect(opened.problems?.join(" ")).toMatch(/phases\.json is not valid JSON/);
    expect((await phaseRows(opened)).map((row) => row.id)).toEqual(["B"]);
    await expect(addPhase(opened, OPERATOR, { id: "P1", name: "first", goal: "the first part", weight: 1 })).rejects.toThrow(/phases\.json is not valid JSON/);
  });
});
