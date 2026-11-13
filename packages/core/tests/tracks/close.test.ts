import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openLandingCheckout } from "../../src/land/checkout.ts";
import { joinQueue } from "../../src/land/queue.ts";
import { RESULTS } from "../../src/land/runner.ts";
import { claimTask } from "../../src/state/claims.ts";
import { closeSession, openSession } from "../../src/state/sessions.ts";
import { Records } from "../../src/store/records.ts";
import { closeTrack } from "../../src/tracks/close.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { commitOn } from "../support/landing.ts";
import { helped, isThere } from "../support/helped.ts";
import { sh } from "../support/repo.ts";

const NOW = new Date("2026-11-12T12:00:00.000Z");

const recorded = async (root: string): Promise<{ tracks: { name: string; closedAt?: string }[] }> => JSON.parse(await readFile(join(root, "docs/records/tracks.json"), "utf8"));

describe("closing a track", () => {
  test("is refused while a landing of the track has a place in the queue, and nothing is removed", async () => {
    const { repo, root, tree, operator } = await helped();
    const session = await openSession(repo, { worktree: tree, agent: "sonnet" });
    await commitOn(tree, "src/part.rs", "feat: a part");
    const ticket = await joinQueue(repo, session, { files: [] });
    await sh(root, ["merge", "-q", "--ff-only", "track/helper"]);
    await closeSession(repo, session.id);

    await expect(closeTrack(repo, operator, "helper", NOW)).rejects.toThrow(`track helper has a landing in the queue (ticket ${ticket.id}); wait for it to end, or cancel it`);

    expect(await isThere(tree)).toBe(true);
  });

  test("is refused, with nothing removed, when the repository's checkout is off main and lacks the track's commits", async () => {
    const { repo, root, tree, operator } = await helped();
    await sh(root, ["commit", "-q", "-am", "records: what waited"]);
    await sh(root, ["checkout", "-q", "--detach", "HEAD~2"]);

    await expect(closeTrack(repo, operator, "helper", NOW)).rejects.toThrow("check out main there first");

    expect(await isThere(tree)).toBe(true);
    expect(await sh(root, ["branch", "--list", "track/helper"])).toContain("track/helper");
  });

  test("removes the worktree and the branch, marks the record closed, and the track is gone from the repository", async () => {
    const { repo, root, tree, operator, fresh } = await helped();

    const closed = await closeTrack(repo, operator, "helper", NOW);

    expect(closed.track).toMatchObject({ name: "helper", closedAt: NOW.toISOString() });
    expect(await isThere(tree)).toBe(false);
    expect(await sh(root, ["branch", "--list", "track/helper"])).toBe("");
    expect(await sh(root, ["worktree", "list", "--porcelain"])).not.toContain("helper");
    expect((await recorded(root)).tracks).toMatchObject([{ name: "helper", closedAt: NOW.toISOString() }]);
    expect((await fresh()).config.tracks.map((track) => track.name)).toEqual(["data", "engine"]);
  });

  test("takes away what tally wrote there: the runner, the results it took in and the landing checkout", async () => {
    const { repo, root, tree, operator } = await helped();
    await mkdir(join(tree, RESULTS, "taken", "one"), { recursive: true });
    await writeFile(join(tree, RESULTS, "taken", "one", "exit"), "0\n");
    const checkout = await openLandingCheckout(tree, "helper");
    await writeFile(join(checkout, "left-by-a-run.txt"), "x\n");

    await closeTrack(repo, operator, "helper");

    expect(await isThere(tree)).toBe(false);
    expect(await sh(root, ["worktree", "list", "--porcelain"])).not.toContain("helper");
  });

  test("lets the name be opened again", async () => {
    const { repo, root, operator, data, fresh } = await helped();
    await closeTrack(repo, operator, "helper");

    const again = await openTrack(await fresh(), data, { name: "helper", purpose: "a second pass" });

    expect(again.track.purpose).toBe("a second pass");
    expect((await recorded(root)).tracks.map((track) => track.closedAt === undefined)).toEqual([false, true]);
  });

  test("is for an operator session or a session of the parent track", async () => {
    const { repo, data, engine } = await helped();

    await expect(closeTrack(repo, engine, "helper")).rejects.toThrow("only an operator session or a session of its parent track (data) closes track helper");
    await expect(closeTrack(repo, data, "helper")).resolves.toMatchObject({ track: { name: "helper" } });
  });

  test("commits the record as the other records are committed", async () => {
    const { repo, root, operator } = await helped({ commit: true });

    const closed = await closeTrack(repo, operator, "helper");

    expect(closed.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toBe("records: track helper closed by operator");
  });
});

describe("a track that cannot be closed", () => {
  test("is one of the config's, or is not a track at all", async () => {
    const { repo, operator } = await helped();

    await expect(closeTrack(repo, operator, "engine")).rejects.toThrow("track engine is listed in config.json, and tally closes only the tracks it opened");
    await expect(closeTrack(repo, operator, "nobody")).rejects.toThrow("no open track 'nobody'; the tracks tally opened: helper");
  });

  test("has an open session", async () => {
    const { repo, tree, operator } = await helped();
    const session = await openSession(repo, { worktree: tree, agent: "sonnet" });

    await expect(closeTrack(repo, operator, "helper")).rejects.toThrow(`track helper has an open session (sonnet, ${session.id}); close it first`);
    await closeSession(repo, session.id);
    await expect(closeTrack(repo, operator, "helper")).resolves.toBeDefined();
  });

  test("has a claimed task", async () => {
    const { repo, tree, data, operator } = await helped();
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => ({ ...milestone, tasks: [...milestone.tasks, { id: "h1 split", track: "helper", status: "planned" as const, also: [] }] })) }, message: "planned" }));
    await claimTask(repo, data, await new Records(repo).readLedger(), "B2", "h1 split");

    await expect(closeTrack(repo, operator, "helper")).rejects.toThrow("track helper has a claimed task ('h1 split' in B2, held by claude); release it first");
    expect(await isThere(tree)).toBe(true);
  });

  test("has uncommitted work, and the refusal names the files", async () => {
    const { repo, tree, operator } = await helped();
    await writeFile(join(tree, "draft.rs"), "x\n");
    await writeFile(join(tree, "RULES.md"), "# Rules, edited\n");

    await expect(closeTrack(repo, operator, "helper")).rejects.toThrow(`track helper has uncommitted work in ${tree}: RULES.md, draft.rs; commit it or delete it first`);
    expect(await readFile(join(tree, "draft.rs"), "utf8")).toBe("x\n");
  });

  test("has commits that are not on main", async () => {
    const { repo, root, tree, operator } = await helped();
    await commitOn(tree, "src/a.rs", "feat: a");
    await commitOn(tree, "src/b.rs", "feat: b");

    await expect(closeTrack(repo, operator, "helper")).rejects.toThrow("track/helper is 2 commits ahead of main; land its work first, or delete the branch yourself");
    expect(await sh(root, ["branch", "--list", "track/helper"])).toContain("track/helper");
  });

  test("has a worktree that left its branch and holds a commit of its own", async () => {
    const { repo, tree, operator } = await helped();
    await sh(tree, ["checkout", "-q", "--detach"]);
    await commitOn(tree, "src/a.rs", "feat: a");

    await expect(closeTrack(repo, operator, "helper")).rejects.toThrow(`the worktree ${tree} is off track/helper and 1 commit ahead of main; put its work on a branch of your own, or land it first`);
    expect(await isThere(tree)).toBe(true);
  });

  test("closes once its worktree was removed by hand, since nothing is left to lose", async () => {
    const { repo, root, tree, operator } = await helped();
    await sh(root, ["worktree", "remove", tree]);

    await closeTrack(repo, operator, "helper");

    expect(await sh(root, ["branch", "--list", "track/helper"])).toBe("");
    expect((await recorded(root)).tracks[0]?.closedAt).toBeDefined();
  });
});
