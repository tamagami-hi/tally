import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cancelTicket, joinQueue, ticketView, type JoinInput } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import { openSession, type Session } from "../../src/state/sessions.ts";
import { Records, type Repo } from "../../src/store/records.ts";
import { commitOn, edit, landingFixture, type LandingFixture } from "../support/landing.ts";
import { sh } from "../support/repo.ts";

const MESSAGE = "feat(data): the task\n\nwhy it is so\n";
const MINUTE = 60_000;

interface Queued extends LandingFixture {
  session: Session;
  engine: { tree: string; session: Session };
}

async function ready(script = "true"): Promise<Queued> {
  const fixture = await landingFixture(script);
  const engineTree = join(fixture.root, ".temp", "worktrees", "engine");
  await sh(fixture.root, ["worktree", "add", "-q", engineTree, "-b", "track/engine", "main"]);
  const repo: Repo = { ...fixture.repo, config: { ...fixture.repo.config, tracks: [...fixture.repo.config.tracks, { name: "engine", worktree: ".temp/worktrees/engine", branch: "track/engine" }] } };
  const session = await openSession(repo, { worktree: fixture.tree, agent: "claude" });
  const engine = { tree: engineTree, session: await openSession(repo, { worktree: engineTree, agent: "kiro" }) };
  return { ...fixture, repo, session, engine };
}

const landing = (files: string[], extra: Partial<JoinInput> = {}): JoinInput => ({ files, message: MESSAGE, ...extra });

function runScript(path: string): Promise<number> {
  return new Promise((done) => {
    execFile("sh", [path], (error) => done(error === null ? 0 : typeof error.code === "number" ? error.code : 1));
  });
}

async function view(repo: Repo, ticket: string) {
  return ticketView(repo, ticket);
}

describe("joining the landing queue", () => {
  test("answers a ticket at the head, and the turn prepares it without touching the worktree's other files", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    await edit(q.tree, "src/draft.rs", "not ready\n");

    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);

    const seen = await view(q.repo, ticket.id);
    expect(seen.state).toBe("turn");
    expect(seen.position).toBe(0);
    expect(seen.run).toBe(`sh ${join(q.tree, ".temp/tally/land.sh")}`);
    expect(await sh(q.tree, ["log", "-1", "--format=%s"])).toBe("feat(data): the task");
    expect(await sh(q.tree, ["status", "--porcelain"])).toBe("?? src/draft.rs");
    expect(await q.main()).not.toBe(await q.head());
  });

  test("refuses a landing whose arguments today's landing refuses", async () => {
    const q = await ready();

    await expect(joinQueue(q.repo, q.session, { files: ["src/a.rs"] })).rejects.toThrow("a new commit needs both a message and explicit files");
    await expect(joinQueue(q.repo, q.session, landing(["../outside.rs"]))).rejects.toThrow("file must be relative to the worktree");
  });

  test("gives a session one ticket at a time", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const first = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));

    await expect(joinQueue(q.repo, q.session, landing(["src/a.rs"]))).rejects.toThrow(`this session already has ticket ${first.id} in the queue`);
  });

  test("lets a ticket that has not had its turn be cancelled", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));

    await cancelTicket(q.repo, q.session, ticket.id);

    expect((await view(q.repo, ticket.id)).state).toBe("cancelled");
    await advance(q.repo);
    expect(await sh(q.tree, ["status", "--porcelain"])).toBe("?? src/a.rs");
  });
});

describe("a turn whose checks pass", () => {
  test("lands on main, records the task, and brings the worktree up to main with its other work kept", async () => {
    const q = await ready();
    await new Records(q.repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
    await sh(q.root, ["add", "-A"]);
    await sh(q.root, ["commit", "-q", "-m", "records: plan"]);
    await edit(q.tree, "src/a.rs");
    await edit(q.tree, "src/draft.rs", "not ready\n");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" } }));
    await advance(q.repo);

    expect(await runScript(join(q.tree, ".temp/tally/land.sh"))).toBe(0);
    await advance(q.repo);

    const seen = await view(q.repo, ticket.id);
    expect(seen.state).toBe("landed");
    expect(seen.landed?.commits).toHaveLength(1);
    expect(await sh(q.root, ["log", "-1", "--format=%s", "main"])).toBe("feat(data): the task");
    expect(await q.head()).toBe(await q.main());
    expect(await sh(q.tree, ["status", "--porcelain"])).toBe("?? src/draft.rs");
    const landedTask = (await new Records(q.repo).readLedger()).milestones[0]?.tasks[0];
    expect(landedTask?.status).toBe("landed");
    expect(landedTask?.commit).toBe(seen.landed?.head);
  });

  test("tests every commit ahead of main, oldest first, in the clean checkout", async () => {
    const q = await ready();
    await commitOn(q.tree, "src/one.rs", "feat: one");
    await commitOn(q.tree, "src/two.rs", "feat: two");
    const ticket = await joinQueue(q.repo, q.session, { files: [] });
    await advance(q.repo);

    await runScript(join(q.tree, ".temp/tally/land.sh"));
    await advance(q.repo);

    expect((await q.runs()).map((line) => line.split(" ").slice(1).join(" "))).toEqual(["feat: one", "feat: two"]);
    expect((await view(q.repo, ticket.id)).landed?.commits).toHaveLength(2);
  });

  test("rebases onto a main that moved before the turn, and lands on top of it", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    await writeFile(join(q.root, "src", "main-side.rs"), "x\n");
    await sh(q.root, ["add", "src/main-side.rs"]);
    await sh(q.root, ["commit", "-q", "-m", "feat: on main"]);
    await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);

    await runScript(join(q.tree, ".temp/tally/land.sh"));
    await advance(q.repo);

    expect((await sh(q.root, ["log", "-2", "--format=%s", "main"])).split("\n")).toEqual(["feat(data): the task", "feat: on main"]);
    expect(await readFile(join(q.tree, "src", "main-side.rs"), "utf8")).toBe("x\n");
  });
});

describe("a turn whose checks fail", () => {
  test("leaves main alone, undoes its commit with the files staged, and names the log", async () => {
    const q = await ready("exit 7");
    await edit(q.tree, "src/a.rs");
    const before = await q.main();
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);

    expect(await runScript(join(q.tree, ".temp/tally/land.sh"))).toBe(7);
    await advance(q.repo);

    const seen = await view(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toMatch(/failed its checks \(exit 7\); the log is .*land-.*\.log; .* is undone, and its files stay staged/);
    expect(await q.main()).toBe(before);
    expect(await sh(q.tree, ["status", "--porcelain"])).toBe("A  src/a.rs");
  });

  test("fails a branch that does not rebase onto main, and says which files", async () => {
    const q = await ready();
    await edit(q.tree, "src/lib.rs", "fn track() {}\n");
    await writeFile(join(q.root, "src", "lib.rs"), "fn main_side() {}\n");
    await sh(q.root, ["commit", "-q", "-am", "feat: main changes lib"]);
    const ticket = await joinQueue(q.repo, q.session, landing(["src/lib.rs"]));

    await advance(q.repo);

    const seen = await view(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toContain("data does not rebase onto main: src/lib.rs");
    expect(await sh(q.tree, ["status", "--porcelain"])).toBe("M  src/lib.rs");
  });
});

describe("the order of the queue", () => {
  test("is first come, first served, and each ticket sees who is ahead", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    await edit(q.engine.tree, "src/e.rs");
    const first = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    const second = await joinQueue(q.repo, q.engine.session, landing(["src/e.rs"]));
    await advance(q.repo);

    const waiting = await view(q.repo, second.id);
    expect(waiting.state).toBe("queued");
    expect(waiting.position).toBe(1);
    expect(waiting.ahead.map((ahead) => [ahead.track, ahead.agent, ahead.state])).toEqual([["data", "claude", "turn"]]);

    await runScript(join(q.tree, ".temp/tally/land.sh"));
    await advance(q.repo);

    expect((await view(q.repo, first.id)).state).toBe("landed");
    expect((await view(q.repo, second.id)).state).toBe("turn");
    await runScript(join(q.engine.tree, ".temp/tally/land.sh"));
    await advance(q.repo);
    expect((await sh(q.root, ["log", "-2", "--format=%s", "main"])).split("\n")).toEqual(["feat(data): the task", "feat(data): the task"]);
    expect((await view(q.repo, second.id)).state).toBe("landed");
  });
});

describe("a turn that goes wrong on the way", () => {
  test("is prepared again when main moved while its checks ran", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    await runScript(join(q.tree, ".temp/tally/land.sh"));
    await writeFile(join(q.root, "src", "main-side.rs"), "x\n");
    await sh(q.root, ["add", "src/main-side.rs"]);
    await sh(q.root, ["commit", "-q", "-m", "feat: on main meanwhile"]);

    await advance(q.repo);

    const again = await view(q.repo, ticket.id);
    expect(again.state).toBe("turn");
    expect(again.note).toBe("main moved while the checks ran, so the turn was prepared again; run the script again");
    await runScript(join(q.tree, ".temp/tally/land.sh"));
    await advance(q.repo);
    expect((await view(q.repo, ticket.id)).state).toBe("landed");
    expect((await sh(q.root, ["log", "-2", "--format=%s", "main"])).split("\n")).toEqual(["feat(data): the task", "feat: on main meanwhile"]);
  });

  test("loses its place when its script never starts, and the next ticket gets its turn", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    await edit(q.engine.tree, "src/e.rs");
    const first = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    const second = await joinQueue(q.repo, q.engine.session, landing(["src/e.rs"]));
    await advance(q.repo);

    await advance(q.repo, new Date(Date.now() + 3 * MINUTE));

    const lost = await view(q.repo, first.id);
    expect(lost.state).toBe("failed");
    expect(lost.problem).toContain("its turn timed out: the script was not started within 2 minutes");
    expect(await sh(q.tree, ["status", "--porcelain"])).toBe("A  src/a.rs");
    expect((await view(q.repo, second.id)).state).toBe("turn");
  });

  test("leaves the worktree alone when the agent committed more while the checks ran", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    await runScript(join(q.tree, ".temp/tally/land.sh"));
    const later = await commitOn(q.tree, "src/next.rs", "feat: the next thing");

    await advance(q.repo);

    const seen = await view(q.repo, ticket.id);
    expect(seen.state).toBe("landed");
    expect(seen.note).toBe("the landing is done; your worktree has commits made since, so bring it up to main yourself: git rebase main");
    expect(await q.head()).toBe(later);
  });

  test("refuses a result that is not for the commits being landed", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    await runScript(join(q.tree, ".temp/tally/land.sh"));
    const result = join(q.tree, ".temp/tally/landing", ticket.id, "commits");
    await writeFile(result, "0000000000000000000000000000000000000000 0\n");

    await advance(q.repo);

    expect((await view(q.repo, ticket.id)).problem).toContain("the result is not for the commits being landed");
  });
});
