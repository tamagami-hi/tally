import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { blockingChanges, checkoutState, operatorChanges } from "../../src/land/operator.ts";
import { joinQueue, queueFile, ticketView, trackSession } from "../../src/land/queue.ts";
import { advance } from "../../src/land/turn.ts";
import { commitOn, edit } from "../support/landing.ts";
import { landing, ready, runHead } from "../support/queue.ts";
import { sh } from "../support/repo.ts";

const tickets = async (q: Awaited<ReturnType<typeof ready>>): Promise<number> => (await queueFile(q.repo).read()).tickets.length;

describe("the files that stop a landing in the operator checkout", () => {
  test("are the uncommitted ones the landing changes, a file inside a folder the landing adds included", () => {
    const changes = ["docs/plan.md", "src/a.rs", "web", "tools/x/y.sh"];

    expect(blockingChanges(changes, ["src/a.rs", "web/page.tsx", "tools/x"])).toEqual(["src/a.rs", "web", "tools/x/y.sh"]);
  });

  test("are compared as paths, so ./ and a trailing / still match", () => {
    expect(blockingChanges(["src/lib.rs", "vendor/x"], ["./src/lib.rs", "vendor/x/a.c", "docs/"])).toEqual(["src/lib.rs", "vendor/x"]);
  });

  test("name an untracked repository inside the checkout without its trailing /", async () => {
    const q = await ready();
    await mkdir(join(q.root, "vendor", "x"), { recursive: true });
    await sh(join(q.root, "vendor", "x"), ["init", "-q"]);
    await writeFile(join(q.root, "vendor", "x", "a.c"), "x\n");

    expect(await operatorChanges(q.repo)).toEqual(["vendor/x"]);
  });

  test("leave the records folder out", async () => {
    const q = await ready();
    await writeFile(join(q.root, "docs", "records", "ledger.json"), "{}\n");
    await edit(q.root, "docs/records/notes/one.json", "{}\n");
    await edit(q.root, "docs/plan.md", "draft\n");

    expect(await operatorChanges(q.repo)).toEqual(["docs/plan.md"]);
  });

  test("are shown with no branch while the checkout's HEAD is detached", async () => {
    const q = await ready();
    await sh(q.root, ["checkout", "-q", "--detach"]);

    expect((await checkoutState(q.repo)).branch).toBeNull();
  });

  test("are shown with the branch, at most 20 named and the total given", async () => {
    const q = await ready();
    for (let index = 0; index < 22; index += 1) await edit(q.root, `notes/n${String(index).padStart(2, "0")}.md`);
    await edit(q.root, "docs/records/extra.json", "{}\n");

    const state = await checkoutState(q.repo);

    expect(state.branch).toBe("main");
    expect(state.total).toBe(22);
    expect(state.changed).toHaveLength(20);
    expect(state.changed[0]).toBe("notes/n00.md");
  });
});

describe("a landing meets the operator checkout", () => {
  test("lands past an uncommitted file it does not change, and leaves that file as it was", async () => {
    const q = await ready();
    await edit(q.root, "docs/plan.md", "the coordinator's plan\n");
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    expect((await ticketView(q.repo, ticket.id)).state).toBe("landed");
    expect(await readFile(join(q.root, "docs/plan.md"), "utf8")).toBe("the coordinator's plan\n");
  });

  test("is refused at land_start for an uncommitted file it changes, naming the file and the checkout", async () => {
    const q = await ready();
    await writeFile(join(q.root, "src", "lib.rs"), "fn edited() {}\n");
    await edit(q.tree, "src/lib.rs", "fn b() {}\n");

    await expect(joinQueue(q.repo, q.session, landing(["src/lib.rs"]))).rejects.toThrow(`the operator checkout at ${q.root} has uncommitted changes in 1 file this landing changes: src/lib.rs; commit or stash them there, then land again`);
    expect(await tickets(q)).toBe(0);
  });

  test("counts the commits the track already has among the files it changes", async () => {
    const q = await ready();
    await commitOn(q.tree, "src/lib.rs", "feat: b", "fn b() {}\n");
    await writeFile(join(q.root, "src", "lib.rs"), "fn edited() {}\n");

    await expect(joinQueue(q.repo, q.session, { files: [] })).rejects.toThrow("this landing changes: src/lib.rs");
    expect(await tickets(q)).toBe(0);
  });

  test("is refused for an untracked file at a path it adds", async () => {
    const q = await ready();
    await edit(q.root, "src/a.rs", "the operator's own\n");
    await edit(q.tree, "src/a.rs");

    await expect(joinQueue(q.repo, q.session, landing(["src/a.rs"]))).rejects.toThrow("1 file this landing changes: src/a.rs");
    expect(await tickets(q)).toBe(0);
  });

  test("names a renamed file by both its paths and a path with a space whole", async () => {
    const q = await ready();
    await sh(q.root, ["mv", "src/lib.rs", "src/core.rs"]);
    await edit(q.root, "src/my file.rs", "the operator's\n");
    await edit(q.tree, "src/lib.rs", "fn b() {}\n");
    await edit(q.tree, "src/my file.rs");

    await expect(joinQueue(q.repo, q.session, landing(["src/lib.rs", "src/my file.rs"]))).rejects.toThrow("2 files this landing changes: src/lib.rs, src/my file.rs;");
  });

  test("fails after its checks when a file it changes was made dirty while they ran, and says the checks passed", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const before = await q.main();
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);
    await edit(q.root, "src/a.rs", "made while the checks ran\n");

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toContain(`the operator checkout at ${q.root} has uncommitted changes in 1 file this landing changes: src/a.rs; its checks passed, so land again once those files are committed or stashed`);
    expect(await q.main()).toBe(before);
  });

  test("is not stopped by record files alone", async () => {
    const q = await ready();
    await mkdir(join(q.root, "docs", "records", "context"), { recursive: true });
    await writeFile(join(q.root, "docs", "records", "context", "finding-1.json"), "{}\n");
    await edit(q.tree, "src/a.rs");
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await advance(q.repo);

    expect(await runHead(q.repo)).toBe(0);
    await advance(q.repo);

    expect((await ticketView(q.repo, ticket.id)).state).toBe("landed");
  });

  test("is refused at land_start while the operator checkout is off main, naming its branch", async () => {
    const q = await ready();
    await sh(q.root, ["checkout", "-q", "-b", "elsewhere"]);
    await edit(q.tree, "src/a.rs");

    await expect(joinQueue(q.repo, q.session, landing(["src/a.rs"]))).rejects.toThrow(`the operator checkout at ${q.root} is on elsewhere, not main; check out main there, then land again`);
    expect(await tickets(q)).toBe(0);
  });
});

describe("a landing meets the operator checkout later", () => {
  test("fails at its turn, before any script, when a file it changes was made dirty after land_start, and undoes its commit", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");
    const before = await q.main();
    const ticket = await joinQueue(q.repo, q.session, landing(["src/a.rs"]));
    await edit(q.root, "src/a.rs", "the operator's own\n");

    await advance(q.repo);

    const seen = await ticketView(q.repo, ticket.id);
    expect(seen.state).toBe("failed");
    expect(seen.problem).toMatch(/1 file this landing changes: src\/a\.rs; commit or stash them there, then land again; [0-9a-f]{7} is undone, and its files stay staged/);
    expect(seen.run).toBeUndefined();
    expect(await q.main()).toBe(before);
  });

  test("is not stopped by a dirty file that main changed since the track branched, when the track does not change it", async () => {
    const q = await ready();
    await commitOn(q.tree, "src/a.rs", "feat: a");
    await commitOn(q.root, "src/b.rs", "feat: b on main");
    await edit(q.root, "src/b.rs", "the operator's edit\n");

    const ticket = await joinQueue(q.repo, q.session, { files: [] });

    expect(ticket.state).toBe("queued");
  });

  test("is refused, naming the branch, while the operator checkout's HEAD is detached", async () => {
    const q = await ready();
    await sh(q.root, ["checkout", "-q", "--detach"]);
    await edit(q.tree, "src/a.rs");

    await expect(joinQueue(q.repo, q.session, landing(["src/a.rs"]))).rejects.toThrow(`the operator checkout at ${q.root} is on no branch (its HEAD is detached), not main`);
  });

  test("is refused while the operator checkout is in the middle of a merge", async () => {
    const q = await ready();
    await sh(q.root, ["checkout", "-q", "-b", "side"]);
    await commitOn(q.root, "src/lib.rs", "feat: side", "fn side() {}\n");
    await sh(q.root, ["checkout", "-q", "main"]);
    await commitOn(q.root, "src/lib.rs", "feat: main", "fn main_side() {}\n");
    await sh(q.root, ["merge", "-q", "side"]).catch(() => undefined);
    await edit(q.tree, "src/a.rs");

    await expect(joinQueue(q.repo, q.session, landing(["src/a.rs"]))).rejects.toThrow(`the operator checkout at ${q.root} is in the middle of a merge; finish it or abort it there, then land again`);
  });

  test("of a track whose branch is not there yet joins the queue, and its turn says what is wrong", async () => {
    const q = await ready();
    const repo = { ...q.repo, config: { ...q.repo.config, tracks: [...q.repo.config.tracks, { name: "ghost", worktree: ".temp/worktrees/ghost", branch: "track/ghost" }] } };

    const ticket = await joinQueue(repo, trackSession(repo, "ghost", "op"), { files: [] });

    expect(ticket.state).toBe("queued");
  });
});
