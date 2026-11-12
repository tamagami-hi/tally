import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { logActivity, readActivity } from "../../src/records/activity.ts";
import { addQuestion } from "../../src/records/questions.ts";
import type { Repo } from "../../src/store/records.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const claimed = { session: "s-data", track: "data", agent: "claude", verb: "task_claim", target: "B2 / 4 manifest" };
const closed = { session: "s-engine", track: "engine", agent: "kiro", verb: "session_close" };
const at = (time: string): Date => new Date(`2026-11-${time}:00Z`);

async function threeEvents(): Promise<Repo> {
  const { repo } = await makeTracked();
  await logActivity(repo, claimed, at("12T09:00"));
  await logActivity(repo, closed, at("12T23:30"));
  await logActivity(repo, { ...claimed, verb: "task_land" }, at("13T00:10"));
  return repo;
}

const verbs = async (repo: Repo, filter: Parameters<typeof readActivity>[1]): Promise<string[]> => (await readActivity(repo, filter)).events.map((event) => event.verb);

describe("the activity log", () => {
  test("an event is appended to its day's file", async () => {
    const { repo, root } = await makeTracked();

    const first = await logActivity(repo, claimed, at("12T09:00"));
    const second = await logActivity(repo, closed, at("12T23:30"));
    await logActivity(repo, claimed, at("13T00:10"));

    expect(first).toEqual({ at: "2026-11-12T09:00:00.000Z", ...claimed });
    expect(second).toEqual({ at: "2026-11-12T23:30:00.000Z", ...closed });
    expect(JSON.parse(await readFile(join(root, "docs/records/log/2026-11-12.json"), "utf8"))).toEqual({ schema: 1, date: "2026-11-12", events: [first, second] });
    expect(JSON.parse(await readFile(join(root, "docs/records/log/2026-11-13.json"), "utf8"))).toMatchObject({ date: "2026-11-13", events: [{ verb: "task_claim" }] });
  });

  test("an event is not committed on its own, and rides with the next records commit", async () => {
    const { repo, root } = await makeTracked({ commit: true });
    const commits = async (): Promise<string> => sh(root, ["rev-list", "--count", "HEAD"]);
    const before = await commits();

    await logActivity(repo, claimed, at("12T09:00"));
    const afterEvent = [await commits(), await sh(root, ["status", "--porcelain", "--untracked-files=all", "--", "docs/records/log"])];
    await addQuestion(repo, { group: "platform", question: "Lots?", meanwhile: "refused" });

    expect(afterEvent).toEqual([before, "?? docs/records/log/2026-11-12.json"]);
    expect(await sh(root, ["show", "--stat", "--format=%s", "HEAD"])).toContain("docs/records/log/2026-11-12.json");
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });

  test("is read in order across its days, after a time, for one track, and the latest when limited", async () => {
    const repo = await threeEvents();

    const all = await readActivity(repo);

    expect(all.events.map((event) => [event.at.slice(0, 16), event.verb])).toEqual([["2026-11-12T09:00", "task_claim"], ["2026-11-12T23:30", "session_close"], ["2026-11-13T00:10", "task_land"]]);
    expect(all.matched).toBe(3);
    expect(await verbs(repo, { since: "2026-11-12T09:00:00Z" })).toEqual(["session_close", "task_land"]);
    expect(await verbs(repo, { since: "2026-11-13T05:00:00+05:30" })).toEqual(["task_land"]);
    expect(await verbs(repo, { track: "data" })).toEqual(["task_claim", "task_land"]);
    expect(await readActivity(repo, { limit: 2 })).toMatchObject({ events: [{ verb: "session_close" }, { verb: "task_land" }], matched: 3 });
  });

  test("reads as empty before anything is logged, and refuses a time or a limit it cannot read", async () => {
    const { repo } = await makeTracked();

    expect(await readActivity(repo)).toEqual({ events: [], matched: 0 });
    await expect(readActivity(repo, { since: "this morning" })).rejects.toThrow("since must be an ISO time such as 2026-11-12T09:00:00Z, not 'this morning'");
    await expect(readActivity(repo, { limit: 1.5 })).rejects.toThrow("limit must be a whole number above zero, not 1.5");
  });

  test("writers at the same moment each leave their event", async () => {
    const { repo } = await makeTracked();

    await Promise.all(["a", "b", "c", "d", "e"].map((verb) => logActivity(repo, { ...claimed, verb }, at("12T09:00"))));

    expect((await verbs(repo, {})).sort()).toEqual(["a", "b", "c", "d", "e"]);
  });
});
