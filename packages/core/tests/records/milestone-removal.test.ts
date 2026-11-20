import { describe, expect, test } from "vitest";
import { addMilestone, wait } from "../../src/ledger/ops.ts";
import { joinQueue } from "../../src/land/queue.ts";
import { recordEvidence, listEvidence } from "../../src/records/evidence.ts";
import { removeMilestone } from "../../src/records/milestone-removal.ts";
import { listNotes } from "../../src/records/notes.ts";
import { claimTask } from "../../src/state/claims.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { edit } from "../support/landing.ts";
import { landing, ready } from "../support/queue.ts";
import { makeTracked } from "../support/tracked.ts";

const ids = async (repo: Repo): Promise<string[]> => (await new Records(repo).readLedger()).milestones.map((one) => one.id);

async function withB3(repo: Repo): Promise<void> {
  await new Records(repo).update((ledger) => addMilestone(ledger, { id: "B3", stage: "B", name: "cache", track: "data", weight: 1 }, ["B"]));
  await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((one) => (one.id !== "B3" ? one : { ...one, tasks: [{ id: "1 cache", track: "data", status: "planned" as const, also: [] }, { id: "2 evict", track: "data", status: "planned" as const, also: [] }] })) }, message: "planned" }));
}

async function tracked() {
  const made = await makeTracked();
  await withB3(made.repo);
  return {
    ...made,
    operator: await openSession(made.repo, { worktree: made.root, agent: "operator" }),
    data: await openSession(made.repo, { worktree: made.trees["data"]!, agent: "claude" }),
    engine: await openSession(made.repo, { worktree: made.trees["engine"]!, agent: "kiro" }),
  };
}

describe("removing a milestone", () => {
  test("takes it out with its planned tasks, keeps its run records, and tells the tracks that waited on it", async () => {
    const { repo, trees, operator, data } = await tracked();
    await new Records(repo).update((ledger) => wait(ledger, { milestone: "B2", task: "T9 store", what: "the cache", on: "B3:1 cache" }));
    await recordEvidence(repo, data, await new Records(repo).readLedger(), { milestone: "B3", task: "1 cache", kind: "red", command: ["cargo", "test"], cwd: trees["data"]!, started: "2026-11-20T09:00:00.000Z", seconds: 1, exit: 101, summary: { failed: 1 } });

    const removed = await removeMilestone(repo, { milestone: "B3", why: "the cache moved to the next phase", decision: "DEC-9" }, operator);

    expect(await ids(repo)).toEqual(["B2"]);
    expect(removed.message).toBe("B3: removed with its 2 planned tasks (the cache moved to the next phase; under DEC-9); still waiting on its tasks: B2 'T9 store'; its 1 run record stays in B3's evidence");
    expect(await listEvidence(repo, "B3")).toHaveLength(1);
    expect((await listNotes(repo, { track: "engine" })).map((note) => note.text)).toEqual([expect.stringContaining("B3 was removed (the cache moved to the next phase)")]);
  });

  test("refuses a milestone with a landed task, which is the record of its commits", async () => {
    const { repo, operator } = await tracked();

    await expect(removeMilestone(repo, { milestone: "B2", why: "no longer wanted" }, operator)).rejects.toThrow("B2 has a landed task ('done'): a milestone with a landed task is the record of its commits and stays; drop what it still owes with milestone_edit");
    expect(await ids(repo)).toEqual(["B2", "B3"]);
  });

  test("refuses while one of its tasks is claimed", async () => {
    const { repo, operator, data } = await tracked();
    await claimTask(repo, data, await new Records(repo).readLedger(), "B3", "1 cache");

    await expect(removeMilestone(repo, { milestone: "B3", why: "moved" }, operator)).rejects.toThrow("'1 cache' in B3 is held by claude on data; that session releases it first, or closes");
    expect(await ids(repo)).toEqual(["B2", "B3"]);
  });

  test("refuses while a queued landing is to record one of its tasks", async () => {
    const q = await ready();
    await new Records(q.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" } }));
    const operator = await openSession(q.repo, { worktree: q.root, agent: "operator" });

    await expect(removeMilestone(q.repo, { milestone: "A1", why: "moved" }, operator)).rejects.toThrow(`a landing in the queue (ticket ${ticket.id}) is to record 't1' in A1; cancel it with land_cancel, or let it land`);
  });

  test("is an operator session's alone, and needs a reason", async () => {
    const { repo, data, operator } = await tracked();

    await expect(removeMilestone(repo, { milestone: "B3", why: "moved" }, data)).rejects.toThrow("only an operator session removes a milestone; a track asks with question_add");
    await expect(removeMilestone(repo, { milestone: "B3", why: "  " }, operator)).rejects.toThrow("say why B3 is removed: the reason goes in the record's commit");
    expect(await ids(repo)).toEqual(["B2", "B3"]);
  });
});
