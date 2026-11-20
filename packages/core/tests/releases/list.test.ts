import { describe, expect, test } from "vitest";
import { listReleases } from "../../src/releases/list.ts";
import { markRelease } from "../../src/releases/mark.ts";
import { AT, releasing } from "../support/releasing.ts";

async function twoReleases(notes = false) {
  const made = await releasing();
  const repo = notes ? { ...made.repo, config: { ...made.repo.config, releases: { notes: "docs/releases/{version}.md" } } } : made.repo;
  const one = await made.onMain("src/one.rs", "feat: one");
  await made.landTask("4 manifest", one);
  await markRelease(repo, made.operator, { version: "1.0.0" }, AT);
  const two = await made.onMain("docs/releases/1.1.0.md", "docs: what is new in 1.1.0");
  const three = await made.onMain("src/three.rs", "feat: three");
  await made.landTask("5 transcoder", two);
  await made.landTask("T9 store", three);
  await markRelease(repo, made.operator, { version: "1.1.0", commit: three }, AT);
  const four = await made.onMain("src/four.rs", "feat: four");
  return { ...made, repo, four };
}

describe("release_list", () => {
  test("answers each release's tasks, landed on main after the release before it and at or before its own commit, newest first", async () => {
    const { repo } = await twoReleases();

    const listed = await listReleases(repo, {});

    expect(listed.releases.map((release) => [release.version, release.tasks])).toEqual([
      ["1.1.0", { count: 2, milestones: [{ milestone: "B2", ids: ["5 transcoder", "T9 store"] }] }],
      ["1.0.0", { count: 1, milestones: [{ milestone: "B2", ids: ["4 manifest"] }] }],
    ]);
  });

  test("answers the landed tasks after the last release as unreleased, and one release when asked by version", async () => {
    const made = await twoReleases();
    await made.landTask("done", made.four);

    const listed = await listReleases(made.repo, { version: "1.0.0" });

    expect(listed.unreleased).toEqual({ count: 1, milestones: [{ milestone: "B2", ids: ["done"] }] });
    expect(listed.releases.map((release) => release.version)).toEqual(["1.0.0"]);
  });

  test("says whether the config's notes file is there at each release's commit, and nothing of it without releases.notes", async () => {
    const withNotes = await twoReleases(true);
    const without = await twoReleases(false);

    expect((await listReleases(withNotes.repo, {})).releases.map((release) => [release.version, release.whatsNew])).toEqual([["1.1.0", true], ["1.0.0", false]]);
    expect((await listReleases(without.repo, {})).releases.every((release) => !("whatsNew" in release))).toBe(true);
  });

  test("refuses a version no release has, naming the ones it has", async () => {
    const { repo } = await twoReleases();

    await expect(listReleases(repo, { version: "2.0.0" })).rejects.toThrow("no release 2.0.0; recorded: 1.1.0, 1.0.0");
  });
});
