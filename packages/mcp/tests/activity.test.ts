import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { activity, isUnlogged, targetOf } from "../src/decorators/activity.ts";
import { ok } from "../src/respond.ts";
import { manyRepos, oneRepo } from "../src/source.ts";
import { logActivity } from "../../core/src/records/activity.ts";
import { configureRepo } from "../../core/src/repos/configure.ts";
import { addRepo } from "../../core/src/repos/list.ts";
import { Repos } from "../../core/src/repos/repos.ts";
import { busyLock } from "../../core/tests/support/busy.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { tmpDir } from "../../core/tests/support/tmp.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, keepingContextAsRecords, opened, type Call } from "./support/connect.ts";

interface Logged {
  session: string;
  track: string;
  agent: string;
  verb: string;
  target?: string;
}

const logged = async (call: Call, args: Record<string, unknown> = {}): Promise<Logged[]> => (await call("activity_get", args)).structured["events"] as Logged[];

async function serving(records: { commit?: boolean } = {}) {
  const tracked = await makeTracked(records);
  const { call } = await connect(keepingContextAsRecords(tracked.repo));
  return { ...tracked, call, data: await opened(call, tracked.trees["data"]!, "claude") };
}

describe("what an activity event says a call was aimed at", () => {
  test.each([
    [{ milestone: "B2", task: "4 manifest", kind: "green" }, "B2 / 4 manifest, green"],
    [{ milestone: "B2", title: "The store" }, "B2"],
    [{ name: "evidence", note: "a run" }, "evidence"],
    [{ ticket: "t-1" }, "t-1"],
    [{ id: "finding-2", why: "gone" }, "finding-2"],
    [{ kind: "finding", title: "t" }, "finding"],
    [{ lines: ["a note"], id: 7 }, undefined],
    [{ name: "n".repeat(200) }, "n".repeat(120)],
  ])("%j: %s", (args, target) => {
    expect(targetOf(args)).toBe(target);
  });

  test("a tool that only reads, or only waits, is told by the table of tools", () => {
    expect(["session_list", "context_get", "docs_read", "docs_search", "land_wait", "ledger_check", "checks_fingerprint", "context_pack", "buildlog_render"].every(isUnlogged)).toBe(true);
    expect(["task_plan", "context_put", "session_close", "land_start", "checks_set", "buildlog_append", "task_wait", "task_unwait"].some(isUnlogged)).toBe(false);
  });
});

describe("the activity log through the tools", () => {
  test("a write that carried a session is logged with its verb and its target; reads, refusals and calls without a session are not", async () => {
    const { call, data } = await serving();

    await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 more"] });
    await call("task_claim", { sessionId: data, milestone: "B2", task: "4 manifest" });
    await call("lock_acquire", { sessionId: data, name: "evidence", note: "a run" });
    await call("context_put", { sessionId: data, kind: "finding", title: "the lock is a folder", text: "it holds no file" });
    await call("context_retire", { sessionId: data, id: "finding-1", why: "gone" });
    await call("handoff_write", { sessionId: data, lines: ["a note"] });
    await call("task_wait", { sessionId: data, milestone: "B2", task: "5 transcoder", what: "row 7" });
    await call("context_get", { sessionId: data });
    await call("board_get", { sessionId: data });
    await call("handoff_read", { sessionId: data, track: "data" });
    const refused = await call("task_claim", { sessionId: data, milestone: "B2", task: "nope" });
    await call("session_list");

    const events = await logged(call);
    expect(refused.isError).toBe(true);
    expect(events.map((event) => [event.verb, event.target])).toEqual([["task_plan", "B2"], ["task_claim", "B2 / 4 manifest"], ["lock_acquire", "evidence"], ["context_put", "finding"], ["context_retire", "finding-1"], ["handoff_write", undefined], ["task_wait", "B2 / 5 transcoder"]]);
    expect(events.every((event) => event.session === data && event.track === "data" && event.agent === "claude")).toBe(true);
  });

  test("session_close is logged, though the session is gone by then", async () => {
    const { call, data } = await serving();

    const closed = await call("session_close", { sessionId: data });

    expect(closed.isError).toBe(false);
    expect(await logged(call)).toMatchObject([{ verb: "session_close", session: data, track: "data", agent: "claude" }]);
  });

  test("in a repository that keeps its context in Markdown nothing is logged and the answer is handed back as it came", async () => {
    const { repo, root, trees } = await makeTracked();
    const { call } = await connect(repo);
    const data = await opened(call, trees["data"]!);
    const answer = ok({ message: "B2: planned", commit: null });

    const planned = await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 more"] });
    const decorated = await activity({ tool: "task_plan", args: { sessionId: data, milestone: "B2" }, result: answer, source: oneRepo(repo) });
    const closed = await call("session_close", { sessionId: data });

    expect(planned.isError).toBe(false);
    expect(decorated).toBe(answer);
    expect(Object.keys(closed.structured)).toEqual(["session", "releasedClaims", "releasedLocks", "recordsCommit"]);
    await expect(access(join(root, "docs/records/log"))).rejects.toThrow();
    expect(await logged(call)).toEqual([]);
  });

  test("an event waits on disk, and rides with the next records commit", async () => {
    const { call, data, root } = await serving({ commit: true });
    const day = new Date().toISOString().slice(0, 10);
    const waiting = async (): Promise<string> => sh(root, ["status", "--porcelain", "--untracked-files=all", "--", "docs/records/log"]);

    await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 more"] });
    const afterFirst = [await sh(root, ["log", "-1", "--format=%s"]), await waiting()];
    await call("handoff_write", { sessionId: data, lines: ["a note"] });

    expect(afterFirst).toEqual(["records: B2: planned 1 new task(s): 6 more", `?? docs/records/log/${day}.json`]);
    expect(await sh(root, ["show", "--stat", "--format=%s", "HEAD"])).toContain(`docs/records/log/${day}.json`);
    expect(await waiting()).toBe(`M docs/records/log/${day}.json`);
  });

  test("when the last session closes, what waited is committed and the checkout is left clean", async () => {
    const { call, data, root } = await serving({ commit: true });
    await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 more"] });

    await call("session_close", { sessionId: data });

    expect(await sh(root, ["status", "--porcelain", "--untracked-files=all", "--", "docs/records"])).toBe("");
    expect(await sh(root, ["log", "-1", "--format=%s"])).toMatch(/^records: 1 record file up to [0-9a-f]{7}$/);
    expect((await logged(call)).map((event) => event.verb)).toEqual(["task_plan", "session_close"]);
  });

  test("a log that could not be written is said in the answer, and the write itself stands", async () => {
    const { call, data } = await serving();
    busyLock(`${new Date().toISOString().slice(0, 10)}.json`);

    const written = await call("handoff_write", { sessionId: data, lines: ["a note"] });

    expect(written.isError).toBe(false);
    expect(written.structured["handoff"]).toMatchObject({ current: { lines: ["a note"] } });
    expect(written.structured["activityProblem"]).toMatch(/^could not take the lock /);
    expect(written.text).toMatch(/\nthe activity log was not written: could not take the lock /);
    expect((await call("handoff_read", { track: "data" })).structured).toMatchObject({ current: { lines: ["a note"] } });
  });

  test("activity_get answers what came after a time, one track's, and the latest when limited", async () => {
    const { call, repo } = await serving();
    const at = (hour: string): Date => new Date(`2026-11-12T${hour}:00:00Z`);
    await logActivity(repo, { session: "s1", track: "data", agent: "claude", verb: "task_claim", target: "B2 / 4 manifest" }, at("09"));
    await logActivity(repo, { session: "s2", track: "engine", agent: "kiro", verb: "handoff_write" }, at("10"));
    await logActivity(repo, { session: "s1", track: "data", agent: "claude", verb: "task_land", target: "B2 / 4 manifest" }, at("11"));

    expect((await call("activity_get")).structured).toMatchObject({ matched: 3, events: [{ verb: "task_claim", at: "2026-11-12T09:00:00.000Z" }, { verb: "handoff_write" }, { verb: "task_land" }] });
    expect((await logged(call, { since: "2026-11-12T09:30:00Z" })).map((event) => event.verb)).toEqual(["handoff_write", "task_land"]);
    expect((await logged(call, { track: "data" })).map((event) => event.verb)).toEqual(["task_claim", "task_land"]);
    expect((await call("activity_get", { limit: 1 })).structured).toMatchObject({ matched: 3, events: [{ verb: "task_land" }] });
    expect((await call("activity_get", { since: "this morning" })).text).toBe("since must be an ISO time such as 2026-11-12T09:00:00Z, not 'this morning'");
  });

  test("with many repositories each one's writes go to its own log, a close among them", async () => {
    const home = await tmpDir("tally-home-");
    const alpha = await makeTracked();
    const beta = await makeTracked();
    await configureRepo(alpha.repo, { track: "main", agent: "operator" }, { context: "records" });
    await addRepo(home, { root: alpha.root, name: "alpha" });
    await addRepo(home, { root: beta.root, name: "beta" });
    const { call } = await connect(manyRepos(new Repos(home)));
    const inAlpha = await opened(call, alpha.trees["data"]!);
    const inBeta = await opened(call, beta.trees["data"]!);

    await call("handoff_write", { sessionId: inAlpha, lines: ["a note"] });
    await call("handoff_write", { sessionId: inBeta, lines: ["a note"] });
    await call("session_close", { sessionId: inAlpha });
    await call("session_close", { sessionId: inBeta });

    expect((await logged(call, { repo: "alpha" })).map((event) => [event.verb, event.session])).toEqual([["handoff_write", inAlpha], ["session_close", inAlpha]]);
    expect((await call("activity_get", { repo: "beta" })).structured).toEqual({ events: [], matched: 0 });
  });
});
