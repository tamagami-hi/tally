import { describe, expect, test } from "vitest";
import { endSession } from "../../src/state/end.ts";
import { expireSessions } from "../../src/state/expire.ts";
import { readRest } from "../../src/state/rest.ts";
import { openSession } from "../../src/state/sessions.ts";
import { makeTracked } from "../support/tracked.ts";

const OPENED = new Date("2026-11-12T09:00:00.000Z");
const ENDED = new Date("2026-11-12T10:00:00.000Z");
const SIX_HOURS_LATER = new Date("2026-11-12T15:00:00.000Z");

describe("a track's rest time", () => {
  test("is unknown until a session of the track ends", async () => {
    const { repo } = await makeTracked();

    expect(await readRest(repo, "data")).toEqual({});
  });

  test("is stamped when a session ends, for its own track only", async () => {
    const { repo, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, agent: "claude" }, OPENED);
    await openSession(repo, { worktree: trees["engine"]!, agent: "kiro" }, OPENED);

    await endSession(repo, data.id, ENDED);

    expect(await readRest(repo, "data")).toEqual({ endedAt: ENDED.toISOString() });
    expect(await readRest(repo, "engine")).toEqual({});
  });

  test("is stamped when a quiet session expires, at the time of the sweep", async () => {
    const { repo, trees } = await makeTracked();
    await openSession(repo, { worktree: trees["data"]!, agent: "claude" }, OPENED);

    await expireSessions(repo, SIX_HOURS_LATER);

    expect(await readRest(repo, "data")).toEqual({ endedAt: SIX_HOURS_LATER.toISOString() });
  });

  test("a track name with a slash is one file", async () => {
    const { repo } = await makeTracked();

    expect(await readRest(repo, "release/1.0")).toEqual({});
  });
});
