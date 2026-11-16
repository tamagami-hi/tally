import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { describe, expect, test } from "vitest";
import { statePath } from "../../src/land/paths.ts";
import { activityPath, readActivity } from "../../src/records/activity.ts";
import { claimTask, listClaims } from "../../src/state/claims.ts";
import { closeIdleSessions, expireSessions } from "../../src/state/expire.ts";
import { acquireLock, listLocks } from "../../src/state/locks.ts";
import { listSessions, openSession } from "../../src/state/sessions.ts";
import type { Repo } from "../../src/store/records.ts";
import { Records } from "../../src/store/records.ts";
import { makeTracked } from "../support/tracked.ts";

const T0 = new Date("2026-11-12T08:00:00.000Z");
const later = (seconds: number): Date => new Date(T0.getTime() + 5 * 60 * 60_000 + seconds * 1000);
const UNLOGGED = /^claude's session on track data was ended as idle, but its expiry was not logged: .*not valid JSON/;

async function unreadable(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "{ not json");
}

async function quiet() {
  const tracked = await makeTracked();
  const repo: Repo = { ...tracked.repo, config: { ...tracked.repo.config, context: "records" } };
  const session = await openSession(repo, { worktree: tracked.trees["data"]!, agent: "claude" }, T0);
  await claimTask(repo, session, await new Records(repo).readLedger(), "B2", "4 manifest", T0);
  await acquireLock(repo, session, "evidence", "measuring", T0);
  return { repo, session };
}

describe("an idle session whose expiry cannot be logged", () => {
  test("is ended all the same, its claim and lock released, and the problem is said in one sentence", async () => {
    const { repo, session } = await quiet();
    await unreadable(activityPath(repo, "2026-11-12"));

    const expired = await closeIdleSessions(repo, later(0));

    expect(expired.closed.map((one) => one.id)).toEqual([session.id]);
    expect(await listSessions(repo)).toEqual([]);
    expect(await listClaims(repo)).toEqual([]);
    expect(await listLocks(repo)).toEqual([]);
    expect(expired.problems).toHaveLength(1);
    expect(expired.problems[0]).toMatch(UNLOGGED);
  });

  test("through expireSessions is ended too, and the sentence is thrown after", async () => {
    const { repo } = await quiet();
    await unreadable(activityPath(repo, "2026-11-12"));

    await expect(expireSessions(repo, later(0))).rejects.toThrow(UNLOGGED);
    expect(await listSessions(repo)).toEqual([]);
  });
});

describe("an idle session whose end fails before it is removed", () => {
  test("has one session_expire event however many passes try to end it", async () => {
    const { repo, session } = await quiet();
    await unreadable(statePath(repo, "claims.json"));

    for (const seconds of [0, 2, 4]) await expect(closeIdleSessions(repo, later(seconds))).rejects.toThrow(/not valid JSON/);

    const expiries = (await readActivity(repo)).events.filter((event) => event.verb === "session_expire");
    expect(expiries.map((event) => event.session)).toEqual([session.id]);
    expect((await listSessions(repo)).map((one) => one.id)).toEqual([session.id]);
  });
});
