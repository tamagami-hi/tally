import { describe, expect, test } from "vitest";
import { assertMayWrite, openSession } from "../../src/state/sessions.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { opening } from "../support/opening.ts";

describe("who may write a child track's records", () => {
  test("its parent's session may, its own session may, and another track's session may not", async () => {
    const { repo, data, engine, fresh } = await opening();
    const opened = await openTrack(repo, data, { name: "helper", purpose: "split the reader" });
    const now = await fresh();
    const helper = await openSession(now, { worktree: opened.track.worktree, agent: "sonnet" });

    expect(() => assertMayWrite(now, data, "helper")).not.toThrow();
    expect(() => assertMayWrite(now, helper, "helper")).not.toThrow();
    expect(() => assertMayWrite(now, engine, "helper")).toThrow(`session ${engine.id} is bound to track engine and may not write track helper's records`);
  });

  test("a child's session may not write its parent's records", async () => {
    const { repo, data, fresh } = await opening();
    const opened = await openTrack(repo, data, { name: "helper", purpose: "split the reader" });
    const now = await fresh();
    const helper = await openSession(now, { worktree: opened.track.worktree, agent: "sonnet" });

    expect(() => assertMayWrite(now, helper, "data")).toThrow("may not write track data's records");
  });

  test("a parent named in config.json counts the same", async () => {
    const { repo, data, engine } = await opening();
    const withChild = { ...repo, config: { ...repo.config, tracks: [...repo.config.tracks, { name: "probe", worktree: ".temp/worktrees/probe", branch: "track/probe", parent: "data" }] } };

    expect(() => assertMayWrite(withChild, data, "probe")).not.toThrow();
    expect(() => assertMayWrite(withChild, engine, "probe")).toThrow("may not write track probe's records");
  });
});
