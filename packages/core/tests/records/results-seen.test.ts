import { execFile } from "node:child_process";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { RUNNER, writeRunner } from "../../src/land/runner.ts";
import { takeResults } from "../../src/records/results.ts";
import { listSessions, openSession } from "../../src/state/sessions.ts";
import { makeTracked, type Tracked } from "../support/tracked.ts";

const OPENED = new Date("2026-11-12T08:00:00.000Z");
const TAKEN = new Date("2026-11-12T11:30:00.000Z");

function run(tree: string, args: readonly string[]): Promise<void> {
  return new Promise((done) => {
    execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, () => done());
  });
}

async function ready(): Promise<Tracked & { tree: string }> {
  const tracked = await makeTracked();
  const tree = tracked.trees["data"] ?? "";
  await writeRunner(tracked.repo, tree, "data");
  return { ...tracked, tree };
}

const seenAt = async (repo: Tracked["repo"]): Promise<Record<string, string>> => Object.fromEntries((await listSessions(repo)).map((session) => [session.agent, session.lastSeenAt]));

describe("a run taken in from a worktree", () => {
  test("marks the session open there as seen, and no session of another worktree", async () => {
    const { repo, tree, trees } = await ready();
    await openSession(repo, { worktree: tree, agent: "claude" }, OPENED);
    await openSession(repo, { worktree: trees["engine"] ?? "", agent: "kiro" }, OPENED);
    await run(tree, ["green", "--task", "B2:4 manifest", "--", "true"]);

    await takeResults(repo, TAKEN);

    expect(await seenAt(repo)).toEqual({ claude: TAKEN.toISOString(), kiro: OPENED.toISOString() });
  });

  test("marks it for a run that was set aside too, since the agent that made it is still there", async () => {
    const { repo, tree } = await ready();
    await openSession(repo, { worktree: tree, agent: "claude" }, OPENED);
    await run(tree, ["green", "--", "true"]);

    const taken = await takeResults(repo, TAKEN);

    expect(taken[0]?.problem).toContain("the run names no task");
    expect(await seenAt(repo)).toEqual({ claude: TAKEN.toISOString() });
  });

  test("marks nothing when no result waits, or when no session is open in the worktree", async () => {
    const { repo, tree, trees } = await ready();
    await openSession(repo, { worktree: trees["engine"] ?? "", agent: "kiro" }, OPENED);

    await takeResults(repo, TAKEN);
    await run(tree, ["green", "--task", "B2:4 manifest", "--", "true"]);
    await takeResults(repo, TAKEN);

    expect(await seenAt(repo)).toEqual({ kiro: OPENED.toISOString() });
  });
});
