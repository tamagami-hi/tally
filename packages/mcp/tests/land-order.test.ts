import { describe, expect, test } from "vitest";
import { commitOn } from "../../core/tests/support/landing.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect } from "./support/connect.ts";

describe("track_list with order", () => {
  test("adds the tracks ahead of main and a suggested order marked as a suggestion, naming what waits on a track; without order it answers as before", async () => {
    const { repo, trees } = await makeTracked();
    await commitOn(trees["data"]!, "src/a.rs", "feat: a");
    const { call } = await connect(repo);

    const ordered = (await call("track_list", { order: true })).structured;
    const plain = (await call("track_list", {})).structured;

    expect(ordered).toMatchObject({ ahead: [{ name: "data", commits: 1, files: ["src/a.rs"], overlaps: [] }], landOrder: [{ track: "data", reason: "others wait on it: B2 'T9 store'" }], suggestion: true });
    expect(Object.keys(plain)).toEqual(["tracks"]);
  });
});
