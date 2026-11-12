import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { findMilestone, findTask } from "../../src/ledger/items.ts";
import { joinQueue, queueFile, ticketSchema, ticketView } from "../../src/land/queue.ts";
import { recordLanding, recordTask } from "../../src/land/record.ts";
import { landTrack, type LandDeps } from "../../src/land/run.ts";
import { advance } from "../../src/land/turn.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { edit } from "../support/landing.ts";
import { landing, ready, runHead } from "../support/queue.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const deps: LandDeps = { runTests: async () => undefined, log: () => undefined };

const deferred = [{ what: "the index", to: "B2:5 transcoder" }, { what: "the docs" }];

async function taskOf(repo: Repo, milestone: string, task: string) {
  return findTask(findMilestone(await new Records(repo).readLedger(), milestone), task);
}

describe("recording a landing that deferred parts", () => {
  test("keeps the parts on the task it records, and says the landing was in part", async () => {
    const tracked = await makeTracked();
    const tree = tracked.trees["data"]!;
    await mkdir(join(tree, ".temp"), { recursive: true });
    await writeFile(join(tree, "new.rs"), "x\n");
    await writeFile(join(tree, ".temp", "message.txt"), "feat(data): the task\n");
    const landed = await landTrack(tracked.repo, { track: "data", files: ["new.rs"], messageFile: join(tree, ".temp", "message.txt") }, deps);

    const result = await recordLanding(tracked.repo, landed, { milestone: "B2", task: "4 manifest", deferred });

    expect(result).toEqual({ recorded: true, message: `B2 '4 manifest': landed at ${landed.head}, in part: 2 deferred`, commit: null });
    expect((await taskOf(tracked.repo, "B2", "4 manifest"))?.deferred).toEqual(deferred);
  });

  test("recordTask tells the tasks that stopped waiting through its message", async () => {
    const tracked = await makeTracked();
    const head = await sh(tracked.root, ["rev-parse", "--short=7", "HEAD"]);
    await new Records(tracked.repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((m) => ({ ...m, tasks: m.tasks.map((t) => (t.id === "T9 store" ? { ...t, waitsOn: [{ task: "B2:4 manifest", what: "the manifest" }] } : t)) })) }, message: "waits" }));

    const recorded = await recordTask(tracked.repo, { milestone: "B2", task: "4 manifest", commit: head });

    expect(recorded.message).toBe(`B2 '4 manifest': landed at ${head}; no longer waiting on it: B2 'T9 store'`);
    expect((await taskOf(tracked.repo, "B2", "T9 store"))?.waitsOn).toBeUndefined();
  });
});

describe("a ticket that carries deferred parts", () => {
  async function planned() {
    const q = await ready();
    await new Records(q.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }, { id: "t2", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
    await sh(q.root, ["add", "-A"]);
    await sh(q.root, ["commit", "-q", "-m", "records: plan"]);
    return q;
  }

  test("records them on the task when its turn lands", async () => {
    const q = await planned();
    await edit(q.tree, "src/a.rs");
    const parts = [{ what: "the index", to: "A1:t2" }];
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" }, deferred: parts }));
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("landed");
    expect(seen.landed?.recording).toBe(`A1 't1': landed at ${seen.landed?.head}, in part: 1 deferred`);
    expect(await taskOf(q.repo, "A1", "t1")).toMatchObject({ status: "landed", deferred: parts });
  });

  test("is refused at the door without the task to record them on, or with a part left to no MILESTONE:TASK", async () => {
    const q = await planned();
    await edit(q.tree, "src/a.rs");

    await expect(joinQueue(q.repo, q.session, landing(["src/a.rs"], { deferred }))).rejects.toThrow("deferred parts are recorded on a task: give the landing its milestone and task");
    await expect(joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" }, deferred: [{ what: "the index", to: "later" }] }))).rejects.toThrow("a deferred part's to takes MILESTONE:TASK, not 'later'");
    expect((await queueFile(q.repo).read()).tickets).toEqual([]);
  });

  test("a ticket written before deferred parts existed still parses, with no such key", async () => {
    const q = await planned();
    await edit(q.tree, "src/a.rs");

    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" }, deferred: [] }));

    expect(ticket).not.toHaveProperty("deferred");
    expect(ticketSchema.parse(ticket)).toStrictEqual(ticket);
  });
});
