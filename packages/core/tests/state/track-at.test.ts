import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openSession, trackAt } from "../../src/state/sessions.ts";
import { makeTracked } from "../support/tracked.ts";

describe("the track a worktree belongs to", () => {
  test("is the track whose worktree it is", async () => {
    const { repo, trees } = await makeTracked();

    expect(trackAt(repo, trees["engine"] ?? "")).toBe("engine");
  });

  test("is the main branch for the repository's own checkout", async () => {
    const { repo, root } = await makeTracked();

    expect(trackAt(repo, root)).toBe("main");
  });

  test("is refused for a folder that is no track's worktree, naming the tracks", async () => {
    const { repo, root } = await makeTracked();

    expect(() => trackAt(repo, join(root, "src"))).toThrow(/is not the worktree of any track of .*; its tracks: data \(.*\), engine \(.*\); its own checkout: /);
  });

  test("lets a session open with the worktree alone", async () => {
    const { repo, trees } = await makeTracked();

    const session = await openSession(repo, { worktree: trees["data"] ?? "", agent: "claude" });

    expect(session.track).toBe("data");
  });
});
