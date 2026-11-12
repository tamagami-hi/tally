import { describe, expect, test } from "vitest";
import { changedFiles, overlaps, overlapsOf } from "../../src/status/overlaps.ts";
import { commitOn, edit } from "../support/landing.ts";
import { makeTracked } from "../support/tracked.ts";

describe("what a track has changed", () => {
  test("is its commits ahead of main and its uncommitted work", async () => {
    const { repo, trees } = await makeTracked();
    await commitOn(trees["data"] ?? "", "src/store.rs", "feat: the store");
    await edit(trees["data"] ?? "", "src/draft.rs");

    expect(await changedFiles(repo, "data")).toEqual(["src/draft.rs", "src/store.rs"]);
  });

  test("is nothing for a track level with main", async () => {
    const { repo } = await makeTracked();

    expect(await changedFiles(repo, "engine")).toEqual([]);
  });
});

describe("two tracks that changed the same file", () => {
  test("overlap on that file, and on no other", async () => {
    const { repo, trees } = await makeTracked();
    await commitOn(trees["data"] ?? "", "src/shared.rs", "feat: data's side");
    await commitOn(trees["data"] ?? "", "src/data-only.rs", "feat: only data");
    await edit(trees["engine"] ?? "", "src/shared.rs", "engine's side\n");

    expect(await overlaps(repo)).toEqual([{ file: "src/shared.rs", tracks: ["data", "engine"] }]);
    expect(await overlapsOf(repo, "engine")).toEqual([{ file: "src/shared.rs", with: ["data"] }]);
    expect(await overlapsOf(repo, "main")).toEqual([]);
  });
});
