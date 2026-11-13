import { describe, expect, test } from "vitest";
import { joinQueue } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import { other } from "../../src/ledger/ops.ts";
import { resolveOnMain } from "../../src/git/refs.ts";
import { collectInbox, peekInbox } from "../../src/state/inbox.ts";
import { closeSession, openSession, type Session } from "../../src/state/sessions.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { commitOn, edit } from "../support/landing.ts";
import { landing, ready, runHead, type Queued } from "../support/queue.ts";

interface Watched extends Queued {
  operator: Session;
}

async function watched(): Promise<Watched> {
  const q = await ready();
  const operator = await openSession(q.repo, { worktree: q.root, agent: "operator" });
  for (const session of [operator, q.session, q.engine.session]) await collectInbox(q.repo, session);
  return { ...q, operator };
}

const ledgerNews = async (repo: Repo, session: Session): Promise<string[]> => (await collectInbox(repo, session)).filter((item) => item.kind === "ledger").map((item) => item.text);

const short = (hash: string): string => hash.slice(0, 7);

describe("a commit on main the ledger does not record", () => {
  test("is told to the session on main, once, with how to record it", async () => {
    const q = await watched();
    const byHand = await commitOn(q.root, "docs/plan.md", "docs(plan): the maintainer's answers");

    const told = await ledgerNews(q.repo, q.operator);

    expect(told).toEqual([`main has 1 commit the ledger does not record: ${short(byHand)} docs(plan): the maintainer's answers. Record it with task_land if it is a task's commit, or with task_other and a note if it is not.`]);
    expect(await ledgerNews(q.repo, q.operator)).toEqual([]);
  });

  test("is not told to a track's session while a session is on main, and is told to every session when none is", async () => {
    const q = await watched();
    await commitOn(q.root, "docs/plan.md", "docs(plan): by hand");

    const whileOperatorIsThere = await ledgerNews(q.repo, q.session);
    await closeSession(q.repo, q.operator.id);
    await commitOn(q.root, "docs/more.md", "docs(plan): more by hand");
    const afterItLeft = await ledgerNews(q.repo, q.session);

    expect(whileOperatorIsThere).toEqual([]);
    expect(afterItLeft).toHaveLength(1);
    expect(afterItLeft[0]).toContain("main has 2 commits the ledger does not record");
    expect(afterItLeft[0]).toContain("Record each with task_land");
  });

  test("is no longer told once it is recorded", async () => {
    const q = await watched();
    const byHand = await commitOn(q.root, "docs/plan.md", "docs(plan): by hand");
    await new Records(q.repo).update((ledger) => other(ledger, { commit: byHand, note: "a plan" }, resolveOnMain(q.root, q.repo.config.mainBranch)));

    expect(await ledgerNews(q.repo, q.operator)).toEqual([]);
  });

  test("is told to a session that opens later, at its first call", async () => {
    const q = await watched();
    await closeSession(q.repo, q.operator.id);
    const byHand = await commitOn(q.root, "docs/plan.md", "docs(plan): by hand");

    const later = await openSession(q.repo, { worktree: q.root, agent: "a later operator" });

    expect((await ledgerNews(q.repo, later))[0]).toContain(short(byHand));
  });

  test("can be read again with inbox_get's reading, for as long as it is not recorded", async () => {
    const q = await watched();
    const byHand = await commitOn(q.root, "docs/plan.md", "docs(plan): by hand");
    await ledgerNews(q.repo, q.operator);

    const again = (await peekInbox(q.repo, q.operator)).filter((item) => item.kind === "ledger");

    expect(again).toHaveLength(1);
    expect(again[0]?.text).toContain(short(byHand));
  });

  test("names at most five, and counts the rest", async () => {
    const q = await watched();
    for (let n = 0; n < 7; n += 1) await commitOn(q.root, `docs/p${n}.md`, `docs: plan ${n}`);

    const [told = ""] = await ledgerNews(q.repo, q.operator);

    expect(told).toContain("main has 7 commits the ledger does not record");
    expect(told.match(/docs: plan/g)).toHaveLength(5);
    expect(told).toContain("and 2 more, which ledger_check lists");
  });
});

describe("a landing through the queue", () => {
  test("that names no task leaves its commit unrecorded, and the track that landed it is told, not the session on main", async () => {
    const q = await watched();
    await edit(q.tree, "src/a.rs");
    await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    await runHead(q.repo);
    await advance(q.repo);

    const track = await ledgerNews(q.repo, q.session);

    expect(track).toHaveLength(1);
    expect(track[0]).toContain("feat(data): the task");
    expect(await ledgerNews(q.repo, q.operator)).toEqual([]);
  });

  test("that records its task tells nobody", async () => {
    const q = await watched();
    await new Records(q.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
    await edit(q.tree, "src/a.rs");
    await joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" } }));
    await advance(q.repo);
    await runHead(q.repo);
    await advance(q.repo);

    expect(await ledgerNews(q.repo, q.session)).toEqual([]);
    expect(await ledgerNews(q.repo, q.operator)).toEqual([]);
  });
});
