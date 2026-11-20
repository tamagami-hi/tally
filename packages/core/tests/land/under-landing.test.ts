import { describe, expect, test } from "vitest";
import { joinQueue, ticketView } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import { Records } from "../../src/store/records.ts";
import { commitOn } from "../support/landing.ts";
import { ready, runHead } from "../support/queue.ts";
import { sh } from "../support/repo.ts";

describe("a landing built under an open question", () => {
  test("records under on the task it lands", async () => {
    const q = await ready();
    await new Records(q.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
    await sh(q.root, ["add", "-A"]);
    await sh(q.root, ["commit", "-q", "-m", "records: plan"]);
    await commitOn(q.tree, "src/one.rs", "feat: one");
    const ticket = await joinQueue(q.repo, q.session, { files: [], target: { milestone: "A1", task: "t1", under: ["Q-3"] } });
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    expect((await ticketView(q.repo, ticket.id)).state).toBe("landed");
    expect((await new Records(q.repo).readLedger()).milestones[0]?.tasks[0]).toMatchObject({ status: "landed", under: ["Q-3"] });
  });
});
