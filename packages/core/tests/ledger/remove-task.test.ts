import { describe, expect, test } from "vitest";
import { findMilestone, findTask } from "../../src/ledger/items.ts";
import { wait } from "../../src/ledger/ops.ts";
import { joinQueue } from "../../src/land/queue.ts";
import { recordEvidence } from "../../src/records/evidence.ts";
import { removeTask } from "../../src/records/task-removal.ts";
import { claimTask, listClaims } from "../../src/state/claims.ts";
import { collectInbox } from "../../src/state/inbox.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { edit } from "../support/landing.ts";
import { landing, ready } from "../support/queue.ts";
import { makeTracked } from "../support/tracked.ts";

const taskOf = async (repo: Repo, milestone: string, task: string) => findTask(findMilestone(await new Records(repo).readLedger(), milestone), task);

async function tracked() {
  const made = await makeTracked();
  const data = await openSession(made.repo, { worktree: made.trees["data"] ?? "", agent: "claude" });
  const engine = await openSession(made.repo, { worktree: made.trees["engine"] ?? "", agent: "kiro" });
  const operator = await openSession(made.repo, { worktree: made.root, agent: "operator" });
  return { ...made, data, engine, operator };
}

describe("removing a task from a repository's records", () => {
  test("takes it out of the ledger and releases the claim of the session that removes it", async () => {
    const { repo, data } = await tracked();
    await claimTask(repo, data, await new Records(repo).readLedger(), "B2", "5 transcoder");

    const removed = await removeTask(repo, { milestone: "B2", task: "5 transcoder", why: "folded into the manifest" }, data);

    expect(removed.message).toBe("B2 '5 transcoder': removed (folded into the manifest)");
    expect(removed.released?.task).toBe("5 transcoder");
    expect(await listClaims(repo)).toEqual([]);
    expect(await taskOf(repo, "B2", "5 transcoder")).toBeUndefined();
    expect(await taskOf(repo, "B2", "4 manifest")).toBeDefined();
  });

  test("is refused while another session holds the task, and nothing changes", async () => {
    const { repo, data, operator } = await tracked();
    await claimTask(repo, data, await new Records(repo).readLedger(), "B2", "5 transcoder");

    await expect(removeTask(repo, { milestone: "B2", task: "5 transcoder", why: "dropped" }, operator)).rejects.toThrow("'5 transcoder' in B2 is held by claude on data; that session releases it first, or closes");
    await expect(removeTask(repo, { milestone: "B2", task: "5 transcoder", why: "dropped" })).rejects.toThrow("is held by claude on data");

    expect(await taskOf(repo, "B2", "5 transcoder")).toBeDefined();
    expect(await listClaims(repo)).toHaveLength(1);
  });

  test("is refused for a session of another track", async () => {
    const { repo, engine } = await tracked();

    await expect(removeTask(repo, { milestone: "B2", task: "5 transcoder", why: "dropped" }, engine)).rejects.toThrow("may not write track data's records");
    expect(await taskOf(repo, "B2", "5 transcoder")).toBeDefined();
  });

  test("is refused while a landing in the queue is to record it", async () => {
    const q = await ready();
    await new Records(q.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" } }));

    await expect(removeTask(q.repo, { milestone: "A1", task: "t1", why: "dropped" }, q.session)).rejects.toThrow(`a landing in the queue (ticket ${ticket.id}) is to record 't1' in A1; cancel it with land_cancel, or let it land`);
    expect(await taskOf(q.repo, "A1", "t1")).toBeDefined();
  });

  test("tells the track whose task waits on it, and keeps the task's run records", async () => {
    const { repo, trees, data, engine } = await tracked();
    await new Records(repo).update((ledger) => wait(ledger, { milestone: "B2", task: "T9 store", what: "its format", on: "B2:5 transcoder" }));
    await recordEvidence(repo, data, await new Records(repo).readLedger(), { milestone: "B2", task: "5 transcoder", kind: "green", command: ["cargo", "test"], cwd: trees["data"] ?? "", started: "2026-11-04T09:00:00.000Z", seconds: 1, exit: 0, summary: { passed: 3 } });
    await collectInbox(repo, engine);

    const removed = await removeTask(repo, { milestone: "B2", task: "5 transcoder", why: "folded into the manifest" }, data);
    const told = await collectInbox(repo, engine);

    expect(removed.message).toBe("B2 '5 transcoder': removed (folded into the manifest); still waiting on it: B2 'T9 store'; its 1 run record stays in B2's evidence");
    expect(removed.evidenceKept).toBe(1);
    expect(told.map((item) => item.text)).toEqual(["heads-up from data (claude): B2:5 transcoder was removed (folded into the manifest); B2 'T9 store' still waits on it: clear the wait, or wait on another task"]);
  });

  test("works without a session, as the command line calls it", async () => {
    const { repo } = await tracked();

    const removed = await removeTask(repo, { milestone: "B2", task: "4 manifest", why: "planned by mistake" });

    expect(removed.message).toBe("B2 '4 manifest': removed (planned by mistake)");
    expect(removed.released).toBeNull();
  });
});
