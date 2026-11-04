import { describe, expect, test } from "vitest";
import { Records } from "../../src/store/records.ts";
import { claimTask, listClaims, releaseClaim, releaseClaimsOf } from "../../src/state/claims.ts";
import { acquireLock, listLocks, releaseLock, releaseLocksOf } from "../../src/state/locks.ts";
import { assertMayWrite, closeSession, getSession, listSessions, openSession } from "../../src/state/sessions.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

describe("sessions bind to a worktree", () => {
  test("opens on the track's worktree and branch, and refuses every other binding", async () => {
    const { repo, root, trees } = await makeTracked();
    const session = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "claude" });
    expect(session.branch).toBe("track/data");
    expect((await listSessions(repo)).map((s) => s.id)).toEqual([session.id]);
    await expect(openSession(repo, { worktree: trees["data"]!, track: "engine", agent: "x" })).rejects.toThrow(/is not the worktree of track engine/);
    await expect(openSession(repo, { worktree: root, track: "nope", agent: "x" })).rejects.toThrow("no track 'nope'; known: main, data, engine");
    await sh(trees["engine"]!, ["checkout", "-q", "-b", "elsewhere"]);
    await expect(openSession(repo, { worktree: trees["engine"]!, track: "engine", agent: "x" })).rejects.toThrow("is not on branch track/engine (it is on elsewhere)");
    const operator = await openSession(repo, { worktree: root, track: "main", agent: "operator" });
    expect(operator.branch).toBe("main");
  });

  test("get touches, close removes, and an unknown id is named", async () => {
    const { repo, trees } = await makeTracked();
    const session = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "claude" }, new Date("2026-11-04T00:00:00Z"));
    const touched = await getSession(repo, session.id, new Date("2026-11-04T01:00:00Z"));
    expect(touched.lastSeenAt).toBe("2026-11-04T01:00:00.000Z");
    await closeSession(repo, session.id);
    await expect(getSession(repo, session.id)).rejects.toThrow(`no session ${session.id}; open one with session_open`);
  });

  test("a track session writes its own track; the operator writes any", async () => {
    const { repo, root, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    const operator = await openSession(repo, { worktree: root, track: "main", agent: "o" });
    expect(() => assertMayWrite(repo, data, "data")).not.toThrow();
    expect(() => assertMayWrite(repo, data, "engine")).toThrow(/bound to track data and may not write track engine/);
    expect(() => assertMayWrite(repo, operator, "engine")).not.toThrow();
  });
});

describe("claims", () => {
  test("one task per session, one session per task, only within scope, never a landed task", async () => {
    const { repo, trees } = await makeTracked();
    const ledger = await new Records(repo).readLedger();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    const engine = await openSession(repo, { worktree: trees["engine"]!, track: "engine", agent: "b" });
    const second = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "c" });
    const claim = await claimTask(repo, data, ledger, "B2", "4 manifest");
    expect(claim).toMatchObject({ milestone: "B2", task: "4 manifest", track: "data", agent: "a" });
    await expect(claimTask(repo, data, ledger, "B2", "T9 store")).rejects.toThrow(/may not write track engine/);
    await expect(claimTask(repo, engine, ledger, "B2", "4 manifest")).rejects.toThrow(/may not write track data/);
    await expect(claimTask(repo, second, ledger, "B2", "4 manifest")).rejects.toThrow(/is claimed by a \(session/);
    await expect(claimTask(repo, data, ledger, "B2", "5 transcoder")).rejects.toThrow(/already holds '4 manifest' in B2; release it first/);
    await expect(claimTask(repo, data, ledger, "B2", "done")).rejects.toThrow("'done' landed at abc1234; nothing to claim");
    await claimTask(repo, engine, ledger, "B2", "T9 store");
    await expect(claimTask(repo, engine, ledger, "B2", "T9 store")).resolves.toMatchObject({ since: expect.any(String) });
    expect((await listClaims(repo)).map((c) => c.task).sort()).toEqual(["4 manifest", "T9 store"]);
    await expect(releaseClaim(repo, engine, "B2", "4 manifest")).rejects.toThrow(/not this one/);
    await releaseClaim(repo, data, "B2", "4 manifest");
    expect(await releaseClaimsOf(repo, engine.id)).toHaveLength(1);
    expect(await listClaims(repo)).toEqual([]);
  });
});

describe("named locks", () => {
  test("are known by the config, held by one session, released by the holder or with the session", async () => {
    const { repo, trees } = await makeTracked();
    const data = await openSession(repo, { worktree: trees["data"]!, track: "data", agent: "a" });
    const engine = await openSession(repo, { worktree: trees["engine"]!, track: "engine", agent: "b" });
    await expect(acquireLock(repo, data, "evidence-host", "x")).rejects.toThrow("no lock 'evidence-host'; known: landing, evidence");
    const lock = await acquireLock(repo, data, "evidence", "B2 measurements");
    expect(lock).toMatchObject({ name: "evidence", agent: "a", note: "B2 measurements" });
    await expect(acquireLock(repo, engine, "evidence", "y")).rejects.toThrow(/'evidence' is held by a \(session .*: B2 measurements$/);
    await expect(releaseLock(repo, engine, "evidence")).rejects.toThrow(/not this one/);
    await acquireLock(repo, engine, "landing", "landing T9");
    expect((await listLocks(repo)).map((l) => l.name).sort()).toEqual(["evidence", "landing"]);
    await releaseLock(repo, data, "evidence");
    expect(await releaseLocksOf(repo, engine.id)).toHaveLength(1);
    expect(await listLocks(repo)).toEqual([]);
    await expect(releaseLock(repo, data, "evidence")).rejects.toThrow("'evidence' is not held");
  });
});
