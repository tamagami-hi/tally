import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeSession } from "../../src/state/sessions.ts";
import { closeTrack } from "../../src/tracks/close.ts";
import { listTracks } from "../../src/tracks/list.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { opening } from "../support/opening.ts";

describe("the list of tracks", () => {
  test("names each track's branch, worktree, parent and purpose, where it comes from, and whether a session is open on it", async () => {
    const { repo, root, data, engine, fresh } = await opening();
    await openTrack(repo, data, { name: "helper", purpose: "split the reader" });
    await closeSession(repo, engine.id);

    const tracks = await listTracks(await fresh());

    expect(tracks).toEqual([
      { name: "data", branch: "track/data", worktree: join(root, ".temp/worktrees/data"), source: "config", hasSession: true },
      { name: "engine", branch: "track/engine", worktree: join(root, ".temp/worktrees/engine"), source: "config", hasSession: false },
      { name: "helper", branch: "track/helper", worktree: join(root, ".temp/worktrees/helper"), parent: "data", purpose: "split the reader", source: "opened", hasSession: false },
    ]);
  });

  test("leaves a closed track out", async () => {
    const { repo, operator, fresh } = await opening();
    await openTrack(repo, operator, { name: "helper", purpose: "split the reader" });
    await closeTrack(await fresh(), operator, "helper");

    expect((await listTracks(await fresh())).map((track) => track.name)).toEqual(["data", "engine"]);
  });
});
