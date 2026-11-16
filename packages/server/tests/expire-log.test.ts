import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, test } from "vitest";
import { listSessions, openSession, type Repo } from "@tally/core";
import { Watcher, type Snapshot } from "../src/watcher.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

const PATIENCE_MS = 15_000;
const TEST_LIMIT_MS = 20_000;
const STEP_MS = 40;
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const UNLOGGED = /^gone's session on track data was ended as idle, but its expiry was not logged: .*not valid JSON/;

async function quietWithBrokenLog() {
  const tracked = await makeTracked();
  const repo: Repo = { ...tracked.repo, config: { ...tracked.repo.config, context: "records" } };
  await openSession(repo, { worktree: tracked.trees["data"]!, agent: "gone" }, new Date(Date.now() - FIVE_HOURS_MS));
  const live = await openSession(repo, { worktree: tracked.trees["engine"]!, agent: "here" });
  const day = join(repo.recordsDir, "log", `${new Date().toISOString().slice(0, 10)}.json`);
  await mkdir(dirname(day), { recursive: true });
  await writeFile(day, "{ not json");
  return { repo, live };
}

async function watching(repo: Repo, options: { holdMs?: number } = {}) {
  const watcher = new Watcher(repo, { intervalMs: STEP_MS, ...options });
  await watcher.current();
  const heard: Snapshot[] = [];
  watcher.subscribe((snapshot) => heard.push(snapshot));
  watcher.start();
  const until = Date.now() + PATIENCE_MS;
  while ((heard.length === 0 || watcher.lastFailure === undefined) && Date.now() < until) await delay(STEP_MS);
  return { watcher, heard };
}

describe("the watcher and an expiry that cannot be logged", () => {
  test("ends the quiet session in the same tick, sends the fresh snapshot, and says why in lastFailure", async () => {
    const { repo, live } = await quietWithBrokenLog();

    const { watcher, heard } = await watching(repo);
    await watcher.stop();

    expect((await listSessions(repo)).map((session) => session.id)).toEqual([live.id]);
    expect(heard[0]?.state.sessions.map((session) => session.agent)).toEqual(["here"]);
    expect(watcher.lastFailure).toMatch(UNLOGGED);
  }, TEST_LIMIT_MS);

  test("keeps saying so on the passes after, until its hold runs out", async () => {
    const { repo } = await quietWithBrokenLog();

    const { watcher } = await watching(repo, { holdMs: 600 });
    await delay(STEP_MS * 5);
    const held = watcher.lastFailure;
    const until = Date.now() + PATIENCE_MS;
    while (watcher.lastFailure !== undefined && Date.now() < until) await delay(STEP_MS);
    await watcher.stop();

    expect(held).toMatch(UNLOGGED);
    expect(watcher.lastFailure).toBeUndefined();
  }, TEST_LIMIT_MS);
});
