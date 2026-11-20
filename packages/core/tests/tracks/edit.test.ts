import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openSession } from "../../src/state/sessions.ts";
import { declaredOverlaps, editTrack } from "../../src/tracks/edit.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { opening } from "../support/opening.ts";

const NOW = new Date("2026-11-20T10:00:00.000Z");

const rowOf = async (root: string, name: string): Promise<Record<string, unknown> | undefined> =>
  (JSON.parse(await readFile(join(root, "docs/records/tracks.json"), "utf8")) as { tracks: Record<string, unknown>[] }).tracks.find((one) => one["name"] === name);

describe("widening a track", () => {
  test("adds paths and keeps who widened it and when, from an operator session", async () => {
    const { repo, root, operator, fresh } = await opening();
    await openTrack(repo, operator, { name: "docs", purpose: "the docs", paths: ["docs/guide"] }, NOW);

    const edited = await editTrack(await fresh(), operator, { name: "docs", addPaths: ["docs/api/", "docs/guide"], purpose: "the guide and the API docs" }, NOW);

    expect(edited.paths).toEqual(["docs/guide", "docs/api"]);
    expect(await rowOf(root, "docs")).toMatchObject({ paths: ["docs/guide", "docs/api"], purpose: "the guide and the API docs", widened: [{ paths: ["docs/api"], by: { track: "main", agent: "operator" }, at: NOW.toISOString() }] });
    expect((await fresh()).config.tracks.find((track) => track.name === "docs")?.paths).toEqual(["docs/guide", "docs/api"]);
  });

  test("lets a session of the parent widen its child, but no wider than the parent", async () => {
    const { repo, root, operator, fresh } = await opening();
    await openTrack(repo, operator, { name: "site", purpose: "the site", paths: ["site"] }, NOW);
    const site = await openSession(await fresh(), { worktree: join(root, ".temp/worktrees/site"), agent: "claude" });
    await openTrack(await fresh(), site, { name: "pages", purpose: "the pages", paths: ["site/pages"] }, NOW);

    const widened = await editTrack(await fresh(), site, { name: "pages", addPaths: ["site/styles"] }, NOW);

    expect(widened.paths).toEqual(["site/pages", "site/styles"]);
    await expect(editTrack(await fresh(), site, { name: "pages", addPaths: ["src"] }, NOW)).rejects.toThrow("track site may land only site, so its child pages cannot land src");
  });

  test("refuses a session that is neither the operator's nor the parent's, a config track, and an edit that changes nothing", async () => {
    const { repo, operator, data, fresh } = await opening();
    await openTrack(repo, operator, { name: "docs", purpose: "the docs", paths: ["docs"] }, NOW);

    await expect(editTrack(await fresh(), data, { name: "docs", addPaths: ["src"] }, NOW)).rejects.toThrow("only an operator session or a session of its parent track (it has none) edits track docs");
    await expect(editTrack(await fresh(), operator, { name: "data", addPaths: ["src"] }, NOW)).rejects.toThrow("track data is listed in config.json; repo_configure changes it");
    await expect(editTrack(await fresh(), operator, { name: "docs" }, NOW)).rejects.toThrow("give addPaths or purpose: nothing would change track docs");
    await expect(editTrack(await fresh(), operator, { name: "docs", addPaths: ["/etc"] }, NOW)).rejects.toThrow("a track's paths are relative to its worktree: /etc");
  });

  test("says a track with no paths is already unlimited, and changes nothing", async () => {
    const { repo, root, operator, fresh } = await opening();
    await openTrack(repo, operator, { name: "docs", purpose: "the docs" }, NOW);

    const edited = await editTrack(await fresh(), operator, { name: "docs", addPaths: ["docs"] }, NOW);

    expect(edited.unlimited).toBe("track docs has no paths, so it may already land any file; nothing was widened");
    expect(await rowOf(root, "docs")).not.toHaveProperty("widened");
  });
});

describe("the tracks whose declared paths overlap", () => {
  test("names each open track that shares a path, with the paths they share, and refuses nothing", async () => {
    const { repo, operator, fresh } = await opening();
    await openTrack(repo, operator, { name: "docs", purpose: "the docs", paths: ["docs", "README.md"] }, NOW);
    await openTrack(await fresh(), operator, { name: "site", purpose: "the site", paths: ["site"] }, NOW);

    const declared = await declaredOverlaps(await fresh(), "api", ["docs/api", "src/api", "site/**/*.css"]);

    expect(declared).toEqual([{ track: "docs", shared: ["docs/api"] }, { track: "site", shared: ["site/**/*.css"] }]);
    expect(await declaredOverlaps(await fresh(), "api", undefined)).toEqual([]);
  });
});
