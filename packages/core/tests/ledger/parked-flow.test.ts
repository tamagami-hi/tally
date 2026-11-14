import { writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { placePart, setDeferred } from "../../src/ledger/deferred.ts";
import { findMilestone, findTask } from "../../src/ledger/items.ts";
import { joinQueue, ticketView } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import { addPhase } from "../../src/phases/add.ts";
import { closePhase } from "../../src/phases/close.ts";
import { addDecision, decisionsPath } from "../../src/records/decisions.ts";
import { Records } from "../../src/store/records.ts";
import { OPERATOR } from "../support/context.ts";
import { parking } from "../support/deferred.ts";
import { edit } from "../support/landing.ts";
import { milestoneIn, phased } from "../support/phased.ts";
import { landing, ready, runHead } from "../support/queue.ts";
import { sh } from "../support/repo.ts";

const PARKED = { why: "polish later", decision: "DEC-14" };

async function planned() {
  const q = await ready();
  await addDecision(q.repo, { id: "DEC-14", group: "platform", text: "Leftovers wait.", since: "2026-11-10", status: "in force" }, { operator: true });
  await new Records(q.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
  await sh(q.root, ["add", "-A"]);
  await sh(q.root, ["commit", "-q", "-m", "records: plan"]);
  return q;
}

describe("a parked part on its way through the queue", () => {
  test("is recorded when its turn lands, though the decision it names went from the record meanwhile, and the answer does not say in part", async () => {
    const q = await planned();
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" }, deferred: [{ what: "the icons", parked: PARKED }] }));
    await writeFile(decisionsPath(q.repo), JSON.stringify({ schema: 1, decisions: [], replaced: [] }));
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.landed?.recording).toBe(`A1 't1': landed at ${seen.landed?.head}, 1 parked`);
    expect(findTask(findMilestone(await new Records(q.repo).readLedger(), "A1"), "t1")?.deferred).toEqual([{ what: "the icons", parked: PARKED }]);
  });
});

describe("a phase whose landed task parked a part", () => {
  test("closes", async () => {
    const made = await phased();
    await addPhase(made.repo, OPERATOR, { id: "G", name: "exports", goal: "Ship exports.", weight: 3 });
    const repo = await made.fresh();
    await milestoneIn(repo, "G", "G1", "data", ["1 csv"]);
    await new Records(repo).update((ledger) => ({
      ledger: { ...ledger, milestones: ledger.milestones.map((one) => (one.id !== "G1" ? one : { ...one, tasks: one.tasks.map((task) => ({ ...task, status: "landed" as const, commit: "abc1234", deferred: [{ what: "the docs", parked: { why: "after the phase" } }] })) })) },
      message: "landed",
    }));

    const closed = await closePhase(repo, OPERATOR, { phase: "G", summary: "done" });

    expect(closed.phase.closedAt).toBeDefined();
  });
});

describe("placing a part, more carefully", () => {
  test("refuses when the part at that place is no longer the one that was read", async () => {
    const { repo } = await parking();
    const ledger = await new Records(repo).readLedger();

    expect(() => placePart(ledger, { milestone: "B2", task: "done", part: 1, to: "B2:5 transcoder" }, "the cache")).toThrow("part 1 of B2 'done' is now 'the docs', not 'the cache': the parts changed meanwhile; read deferred_list again");
  });

  test("says a part is left to a task or parked before it asks who may park", async () => {
    const { repo, data } = await parking();

    await expect(setDeferred(repo, data, { milestone: "B2", task: "done", part: 2, to: "B2:4 manifest", parked: { why: "later" } })).rejects.toThrow("a part is left to a task or parked, not both: 'the cache'");
  });

  test("points at what to do when the task has no parts or is not planned", async () => {
    const { repo, operator } = await parking();

    await expect(setDeferred(repo, operator, { milestone: "B2", task: "4 manifest", part: 1, to: "B2:done" })).rejects.toThrow("B2 '4 manifest' has no deferred parts; deferred_list shows the parts there are");
    await expect(setDeferred(repo, operator, { milestone: "B2", task: "nope", part: 1, to: "B2:done" })).rejects.toThrow("'nope' is not planned in B2; deferred_list shows the parts there are");
  });
});
