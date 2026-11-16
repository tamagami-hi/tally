import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { endedSessions } from "../../src/done/sessions.ts";
import { CLI_SESSION, logActivity, type ActivityInput } from "../../src/records/activity.ts";
import { openSession } from "../../src/state/sessions.ts";
import type { Repo } from "../../src/store/records.ts";
import { makeTracked } from "../support/tracked.ts";

const keepingLog = (repo: Repo): Repo => ({ ...repo, config: { ...repo.config, context: "records" } });

async function logging() {
  const tracked = await makeTracked();
  return { ...tracked, repo: keepingLog(tracked.repo) };
}

const at = (time: string): Date => new Date(`2026-11-${time}:00.000Z`);

async function log(repo: Repo, session: string, events: [string, string, string?][], track = "data", agent = "claude"): Promise<void> {
  for (const [time, verb, target] of events) {
    const input: ActivityInput = { session, track, agent, verb, ...(target === undefined ? {} : { target }) };
    await logActivity(repo, input, at(time));
  }
}

describe("the ended sessions", () => {
  test("group a session's events across day files, from its first event to its last", async () => {
    const { repo } = await logging();
    await log(repo, "s1", [["10T23:50", "session_open"], ["10T23:55", "task_claim", "B2 / 4 manifest"], ["11T00:20", "task_land", "B2 / 4 manifest"], ["11T00:30", "session_close"]]);

    const ended = await endedSessions(repo);

    expect(ended).toEqual({ kept: true, total: 1, sessions: [{ id: "s1", track: "data", agent: "claude", from: at("10T23:50").toISOString(), to: at("11T00:30").toISOString(), opened: "recorded", ended: "closed", writes: 2, tasks: ["B2 / 4 manifest"] }] });
  });

  test("leave out the command line's writes, which are no session's", async () => {
    const { repo } = await logging();
    await log(repo, "cli", [["11T08:00", "decision_add", "shop / ARC-2: built"]], "main", "operator");
    await log(repo, "s1", [["11T09:00", "handoff_write"], ["11T09:10", "session_close"]]);

    const ended = await endedSessions(repo);

    expect(ended.sessions.map((session) => session.id)).toEqual(["s1"]);
    expect(ended.total).toBe(1);
    expect(CLI_SESSION).toBe("cli");
  });

  test("leave out a session that is still open", async () => {
    const { repo, trees } = await logging();
    const open = await openSession(repo, { worktree: trees["data"]!, agent: "claude" });
    await log(repo, open.id, [["11T09:00", "session_open"], ["11T09:05", "handoff_write"]]);
    await log(repo, "gone", [["11T08:00", "handoff_write"], ["11T08:10", "session_close"]]);

    expect((await endedSessions(repo)).sessions.map((session) => session.id)).toEqual(["gone"]);
  });

  test("say how each began and ended: recorded or first write; closed, expired or unknown", async () => {
    const { repo } = await logging();
    await log(repo, "closed", [["11T08:00", "session_open"], ["11T08:30", "session_close"]]);
    await log(repo, "expired", [["11T09:00", "task_plan", "B2"], ["11T13:30", "session_expire", "idle 270 min"]]);
    await log(repo, "unknown", [["11T10:00", "handoff_write"]]);

    const sessions = (await endedSessions(repo)).sessions;

    expect(sessions.map((one) => [one.id, one.opened, one.ended, one.writes])).toEqual([["expired", "first write", "expired", 1], ["unknown", "first write", "unknown", 1], ["closed", "recorded", "closed", 0]]);
  });

  test("keep the newest up to the limit, latest end first, and count them all", async () => {
    const { repo } = await logging();
    for (const [index, hour] of ["08", "09", "10", "11"].entries()) await log(repo, `s${index}`, [[`11T${hour}:00`, "handoff_write"]]);

    const ended = await endedSessions(repo, { limit: 2 });

    expect(ended.total).toBe(4);
    expect(ended.sessions.map((one) => one.id)).toEqual(["s3", "s2"]);
    expect((await endedSessions(repo)).sessions).toHaveLength(4);
  });

  test("name at most eight tasks, distinct, and count the rest", async () => {
    const { repo } = await logging();
    const tasks = Array.from({ length: 10 }, (_, index) => `B2 / t${index}`);
    await log(repo, "busy", [...tasks.map((task, index): [string, string, string] => [`11T10:${String(index).padStart(2, "0")}`, index % 2 === 0 ? "task_claim" : "land_start", task]), ["11T11:00", "task_land", "B2 / t0"], ["11T11:05", "lock_acquire", "evidence"]]);

    const [busy] = (await endedSessions(repo)).sessions;

    expect(busy?.tasks).toEqual(tasks.slice(0, 8));
    expect(busy?.moreTasks).toBe(2);
    expect(busy?.writes).toBe(12);
  });

  test("hold nothing, and say the log is not kept, where the repository keeps none", async () => {
    const { repo } = await makeTracked();

    expect(await endedSessions(repo)).toEqual({ kept: false, sessions: [], total: 0 });
    expect(await endedSessions(keepingLog(repo))).toEqual({ kept: true, sessions: [], total: 0 });
  });

  test("read the newest 120 day files, and count the older ones", async () => {
    const { repo } = await logging();
    const folder = join(repo.recordsDir, "log");
    await mkdir(folder, { recursive: true });
    for (let index = 0; index < 122; index += 1) {
      const day = new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString().slice(0, 10);
      const event = { at: `${day}T10:00:00.000Z`, session: `s${index}`, track: "data", agent: "claude", verb: "handoff_write" };
      await writeFile(join(folder, `${day}.json`), JSON.stringify({ schema: 1, date: day, events: [event] }));
    }

    const ended = await endedSessions(repo, { limit: 500 });

    expect(ended.total).toBe(120);
    expect(ended.earlier).toBe(2);
    expect(ended.sessions.at(-1)?.id).toBe("s2");
  });

  test("refuse a limit that is not a whole number from 1 to 500", async () => {
    const { repo } = await logging();

    for (const limit of [0, 501, 1.5]) await expect(endedSessions(repo, { limit })).rejects.toThrow(`limit must be a whole number from 1 to 500, not ${limit}`);
  });
});
