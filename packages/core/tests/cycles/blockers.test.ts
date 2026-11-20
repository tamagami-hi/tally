import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { queueFile } from "../../src/land/queue.ts";
import { changePhases } from "../../src/phases/file.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { AT, cycling, type Cycling } from "../support/cycling.ts";
import { sh } from "../support/repo.ts";

const SAID = "close it";

async function snapshot(repo: Repo): Promise<string> {
  const files = (await readdir(repo.recordsDir, { recursive: true })).filter((name) => name.endsWith(".json")).sort();
  const contents = await Promise.all(files.map(async (name) => `${name}\n${await readFile(join(repo.recordsDir, name), "utf8")}`));
  return contents.join("\n");
}

async function refused(made: Cycling, first: RegExp): Promise<void> {
  const repo = await made.fresh();
  const before = await snapshot(repo);

  await expect(closeCycle(repo, made.operator, { summary: "done", said: SAID }, AT)).rejects.toThrow(first);

  expect(await snapshot(repo)).toBe(before);
}

describe("what stops a cycle's close, each changing nothing", () => {
  test("a landing in the queue", async () => {
    const made = await cycling();
    await queueFile(made.repo).update((queue) => ({ value: { ...queue, tickets: [{ id: "t-1", sessionId: "s-1", track: "eng", agent: "kiro", worktree: made.root, files: [], state: "queued" as const, since: AT.toISOString(), attempts: 0 }] }, result: undefined }));

    await refused(made, /^cycle 1 cannot close: track eng has a landing in the queue \(ticket t-1\)/);
  });

  test("a commit on main the ledger does not record", async () => {
    const made = await cycling();
    await sh(made.root, ["commit", "-q", "--allow-empty", "-m", "feat: by hand"]);

    await refused(made, /^cycle 1 cannot close: main has 1 commit the ledger does not record/);
  });

  test("a milestone with landed work that is not finished", async () => {
    const made = await cycling();
    await new Records(made.repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((one) => (one.id !== "A1" ? one : { ...one, tasks: [...one.tasks, { id: "3 more", track: "data", status: "planned" as const, also: [] }] })) }, message: "more" }));

    await refused(made, /^cycle 1 cannot close: A1 has landed work and is not finished/);
  });

  test("an open track that is neither carried nor closable now", async () => {
    const made = await cycling();
    await openSession(await made.fresh(), { worktree: join(made.root, ".temp/worktrees/docs"), agent: "kiro" });

    await refused(made, /^cycle 1 cannot close: track docs is neither carried .* nor closable now: track docs has an open session/);
  });

  test("a milestone not started in a phase that is closed", async () => {
    const made = await cycling();
    await changePhases(made.repo.recordsDir, (file) => ({ file: { ...file, phases: file.phases.map((phase) => (phase.id === "C" ? { ...phase, closedAt: AT.toISOString() } : phase)) }, result: undefined }));

    await refused(made, /^cycle 1 cannot close: A2 is not started and sits in phase C, which is closed/);
  });

  test("no finished milestone", async () => {
    const made = await cycling();
    await new Records(made.repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.filter((one) => one.id === "A2"), other: [{ commit: made.landed, note: "the reader, undone" }] }, message: "undone" }));

    await refused(made, /^cycle 1 cannot close: no milestone of cycle 1 is finished yet/);
  });

  test("a track's session, which is told to ask", async () => {
    const made = await cycling();
    const eng = await openSession(await made.fresh(), { worktree: join(made.root, ".temp/worktrees/eng"), agent: "kiro" });

    await expect(closeCycle(await made.fresh(), eng, { summary: "done", said: SAID }, AT)).rejects.toThrow("only an operator session closes a cycle, on the operator's word; a track that wants one closed asks with question_add");
  });

  test("said left empty, and a summary over 500 characters", async () => {
    const made = await cycling();

    await expect(closeCycle(made.repo, made.operator, { summary: "done", said: " " }, AT)).rejects.toThrow("closing a cycle needs the operator's own words in said");
    await expect(closeCycle(made.repo, made.operator, { summary: "x".repeat(501), said: SAID }, AT)).rejects.toThrow("a summary holds at most 500 characters; this one has 501");
  });
});
