import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, test } from "vitest";
import { listSessions, openSession } from "@tally/core";
import { Watcher, type Snapshot } from "../src/watcher.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

const PATIENCE_MS = 15_000;
const TEST_LIMIT_MS = 20_000;
const STEP_MS = 40;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;

describe("the watcher and quiet sessions", () => {
  test("closes a session not seen for hours on its next tick, tells the board, and leaves a live one open", async () => {
    const { repo, trees } = await makeTracked();
    await openSession(repo, { worktree: trees["data"] ?? "", agent: "gone" }, new Date(Date.now() - FIVE_HOURS_MS));
    const live = await openSession(repo, { worktree: trees["engine"] ?? "", agent: "here" });
    const watcher = new Watcher(repo, { intervalMs: STEP_MS });
    await watcher.current();
    const heard: Snapshot[] = [];
    watcher.subscribe((snapshot) => heard.push(snapshot));
    watcher.start();

    const until = Date.now() + PATIENCE_MS;
    while ((await listSessions(repo)).length > 1 && Date.now() < until) await delay(STEP_MS);
    while (heard.length === 0 && Date.now() < until) await delay(STEP_MS);
    await watcher.stop();

    expect((await listSessions(repo)).map((session) => session.id)).toEqual([live.id]);
    expect(heard.at(-1)?.state.sessions.map((session) => session.agent)).toEqual(["here"]);
    expect(watcher.lastFailure).toBeUndefined();
  }, TEST_LIMIT_MS);
});
