import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { handoffSchema } from "../../src/records/handoffs.ts";
import { claimTask, listClaims } from "../../src/state/claims.ts";
import { expireSessions } from "../../src/state/expire.ts";
import { acquireLock, listLocks } from "../../src/state/locks.ts";
import { getSession, listSessions, openSession } from "../../src/state/sessions.ts";
import { writeJsonAtomic } from "../../src/store/json.ts";
import { Records } from "../../src/store/records.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const T0 = new Date("2026-11-12T08:00:00.000Z");
const after = (ms: number): Date => new Date(T0.getTime() + ms);

describe("sessions that go quiet", () => {
  test("a session not seen for four hours is closed with its claim and its lock, and the others stay", async () => {
    const { repo, trees } = await makeTracked();
    const quiet = await openSession(repo, { worktree: trees["data"] ?? "", agent: "claude" }, T0);
    const busy = await openSession(repo, { worktree: trees["engine"] ?? "", agent: "kiro" }, T0);
    await claimTask(repo, quiet, await new Records(repo).readLedger(), "B2", "4 manifest", T0);
    await acquireLock(repo, quiet, "evidence", "measuring", T0);
    await getSession(repo, busy.id, after(3 * HOUR));

    const closed = await expireSessions(repo, after(4 * HOUR + MINUTE));

    expect(closed.map((session) => session.id)).toEqual([quiet.id]);
    expect((await listSessions(repo)).map((session) => session.id)).toEqual([busy.id]);
    expect(await listClaims(repo)).toEqual([]);
    expect(await listLocks(repo)).toEqual([]);
  });

  test("a session seen exactly four hours ago is not yet quiet", async () => {
    const { repo, trees } = await makeTracked();
    await openSession(repo, { worktree: trees["data"] ?? "", agent: "claude" }, T0);

    expect(await expireSessions(repo, after(4 * HOUR))).toEqual([]);
    expect(await listSessions(repo)).toHaveLength(1);
  });

  test("the config's sessions.idleMinutes sets another limit", async () => {
    const { repo, trees } = await makeTracked();
    const patient = { ...repo, config: { ...repo.config, sessions: { idleMinutes: 30 } } };
    const session = await openSession(patient, { worktree: trees["data"] ?? "", agent: "claude" }, T0);

    expect(await expireSessions(patient, after(29 * MINUTE))).toEqual([]);
    expect((await expireSessions(patient, after(31 * MINUTE))).map((closed) => closed.id)).toEqual([session.id]);
  });

  test("the closed session's next call is told to open again", async () => {
    const { repo, trees } = await makeTracked();
    const session = await openSession(repo, { worktree: trees["data"] ?? "", agent: "claude" }, T0);

    await expireSessions(repo, after(5 * HOUR));

    await expect(getSession(repo, session.id)).rejects.toThrow(`no session ${session.id}; open one with session_open`);
  });

  test("closes as session_close does: in batch mode the last session to go commits the records that wait", async () => {
    const { repo, root, trees } = await makeTracked({ commit: true, batch: true });
    await openSession(repo, { worktree: trees["data"] ?? "", agent: "claude" }, T0);
    await writeJsonAtomic(join(repo.recordsDir, "handoffs", "data.json"), handoffSchema.parse({ schema: 1, track: "data" }));

    await expireSessions(repo, after(5 * HOUR));

    expect(await sh(root, ["log", "-1", "--format=%s"])).toMatch(/^records: \d+ record files? up to [0-9a-f]{7}$/);
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });
});
