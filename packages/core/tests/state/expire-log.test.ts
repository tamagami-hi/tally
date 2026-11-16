import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readActivity } from "../../src/records/activity.ts";
import { expireSessions } from "../../src/state/expire.ts";
import { openSession } from "../../src/state/sessions.ts";
import type { Config } from "../../src/schema/config.ts";
import type { Repo } from "../../src/store/records.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const T0 = new Date("2026-11-12T08:00:00.000Z");
const FIVE_HOURS = new Date(T0.getTime() + 5 * 60 * 60_000);

const keepingLog = (repo: Repo): Repo => ({ ...repo, config: { ...repo.config, context: "records" } });

async function quiet(records: Partial<Config["records"]> = {}) {
  const tracked = await makeTracked(records);
  const repo = keepingLog(tracked.repo);
  const session = await openSession(repo, { worktree: tracked.trees["data"]!, agent: "claude" }, T0);
  return { ...tracked, repo, session };
}

describe("a session tally closed because it was idle", () => {
  test("leaves session_expire in the activity log, with how long it was idle", async () => {
    const { repo, session } = await quiet();

    await expireSessions(repo, FIVE_HOURS);

    expect((await readActivity(repo)).events).toEqual([{ at: FIVE_HOURS.toISOString(), session: session.id, track: "data", agent: "claude", verb: "session_expire", target: "idle 300 min" }]);
  });

  test("is logged before its end commits the waiting records, so the event is in that commit", async () => {
    const { repo, root } = await quiet({ commit: true, batch: true });

    await expireSessions(repo, FIVE_HOURS);

    expect(await sh(root, ["status", "--porcelain"])).toBe("");
    expect(await sh(root, ["show", "HEAD:docs/records/log/2026-11-12.json"])).toContain("\"verb\": \"session_expire\"");
  });

  test("leaves nothing where the repository keeps no log", async () => {
    const { repo, root, trees } = await makeTracked();
    await openSession(repo, { worktree: trees["data"]!, agent: "claude" }, T0);

    const closed = await expireSessions(repo, FIVE_HOURS);

    expect(closed).toHaveLength(1);
    await expect(access(join(root, "docs/records/log"))).rejects.toThrow();
  });
});
