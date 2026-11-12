import { utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cancelTicket, findTicket, joinQueue, swapTicket, ticketView } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import { Records } from "../../src/store/records.ts";
import { commitOn, edit } from "../support/landing.ts";
import { sh } from "../support/repo.ts";
import { landing, ready, runCommand, runHead } from "../support/queue.ts";

const SECOND = 1000;
const MINUTE = 60 * SECOND;

describe("a turn that is prepared again", () => {
  test("gets its full time to start, though the first script left a heartbeat", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    await runHead(q.repo);
    await writeFile(join(q.root, "src", "main-side.rs"), "x\n");
    await sh(q.root, ["add", "src/main-side.rs"]);
    await sh(q.root, ["commit", "-q", "-m", "feat: on main meanwhile"]);
    await advance(q.repo);

    await advance(q.repo, new Date(Date.now() + 90 * SECOND));

    expect((await ticketView(q.repo, ticket.id)).state).toBe("turn");
    expect((await ticketView(q.repo, ticket.id)).run).toContain(`${ticket.id}-2.sh`);
  });
});

describe("a turn whose script stops", () => {
  test("loses its place a minute after its last heartbeat", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    const beat = join(q.tree, ".temp/tally/landing", `${ticket.id}-1.beat`);
    await writeFile(beat, "");
    const longAgo = new Date(Date.now() - 2 * MINUTE);
    await utimes(beat, longAgo, longAgo);

    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toContain("its turn timed out: the script stopped and left no result");
  });
});

describe("a script from a turn that was replaced", () => {
  test("runs nothing and leaves the next turn's checkout alone", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const first = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    const stale = (await ticketView(q.repo, first.id)).run ?? "";
    await advance(q.repo, new Date(Date.now() + 3 * MINUTE));
    const second = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    const before = await sh(q.checkout, ["rev-parse", "HEAD"]);
    const runsBefore = (await q.runs()).length;

    const exit = await runCommand(stale);

    expect(exit).toBe(3);
    expect(await sh(q.checkout, ["rev-parse", "HEAD"])).toBe(before);
    expect(await q.runs()).toHaveLength(runsBefore);
    await runHead(q.repo);
    await advance(q.repo);
    expect((await ticketView(q.repo, second.id)).state).toBe("landed");
  });

  test("does not run its checks a second time once it has a result", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    await runHead(q.repo);
    const runsAfterFirst = (await q.runs()).length;

    expect(await runHead(q.repo)).toBe(0);

    expect(await q.runs()).toHaveLength(runsAfterFirst);
  });
});

describe("a landing interrupted by a restart", () => {
  test("is finished and recorded when main was fast-forwarded before the ticket was saved", async () => {
    const q = await ready();
    await new Records(q.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
    await sh(q.root, ["add", "-A"]);
    await sh(q.root, ["commit", "-q", "-m", "records: plan"]);
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" } }));
    await advance(q.repo);
    await runHead(q.repo);
    const prepared = (await findTicket(q.repo, ticket.id)).ticket.turn;
    await sh(q.root, ["merge", "-q", "--ff-only", prepared?.rebased ?? ""]);

    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("landed");
    expect(seen.landed?.commits).toHaveLength(1);
    expect((await new Records(q.repo).readLedger()).milestones[0]?.tasks[0]?.status).toBe("landed");
    expect(await q.head()).toBe(await q.main());
  });

  test("lands files that were committed already, instead of failing on an empty commit", async () => {
    const q = await ready();
    await commitOn(q.tree, "src/a.rs", "feat(data): the task");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));

    await advance(q.repo);

    expect((await ticketView(q.repo, ticket.id)).state).toBe("turn");
    await runHead(q.repo);
    await advance(q.repo);
    expect((await ticketView(q.repo, ticket.id)).state).toBe("landed");
  });
});

describe("a ticket that changed while a step was being made", () => {
  test("keeps the cancellation an agent was told of", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await cancelTicket(q.repo, q.session, ticket.id);

    const outcome = await swapTicket(q.repo, ticket, { ...ticket, state: "failed", problem: "from a step that read it as queued" });

    expect(outcome.swapped).toBe(false);
    expect(outcome.ticket.state).toBe("cancelled");
    expect((await ticketView(q.repo, ticket.id)).state).toBe("cancelled");
  });
});

describe("a track with no check to run", () => {
  test("fails its turn with the reason, at once", async () => {
    const q = await ready();
    const repo = { ...q.repo, config: { ...q.repo.config, tracks: q.repo.config.tracks.map((track) => ({ ...track, test: [] as string[] })) } };
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(repo, q.session, landing(["src/a.rs"]));

    await advance(repo);

    const seen = await ticketView(repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toContain("the config names no check for track data");
  });
});
