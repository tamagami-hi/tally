import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { contextPack } from "../../src/context/pack.ts";
import { findMilestone, findTask } from "../../src/ledger/items.ts";
import { joinQueue } from "../../src/land/queue.ts";
import { recordTask } from "../../src/land/record.ts";
import { addPhase } from "../../src/phases/add.ts";
import { closePhase } from "../../src/phases/close.ts";
import { recordReview } from "../../src/records/reviews.ts";
import { configureRepo } from "../../src/repos/configure.ts";
import { collect } from "../../src/status/collect.ts";
import { Records, openRepo } from "../../src/store/records.ts";
import { OPERATOR } from "../support/context.ts";
import { landedIn, milestoneIn, phased } from "../support/phased.ts";
import { landing, ready } from "../support/queue.ts";
import { edit } from "../support/landing.ts";
import { requiring, reviewing } from "../support/reviews.ts";
import { sh } from "../support/repo.ts";

const NOW = new Date("2026-11-14T12:00:00.000Z");

describe("a landed task's time", () => {
  test("is stamped when the task is recorded as landed, and kept when it is recorded again", async () => {
    const { repo, data, root } = await reviewing();
    const commit = await sh(root, ["rev-parse", "--short=7", "HEAD"]);

    await recordTask(repo, { milestone: "B2", task: "4 manifest", commit }, data, NOW);
    await recordTask(repo, { milestone: "B2", task: "4 manifest", commit, deferred: [] }, data, new Date("2026-11-15T00:00:00.000Z"));

    expect(findTask(findMilestone(await new Records(repo).readLedger(), "B2"), "4 manifest")?.landedAt).toBe(NOW.toISOString());
  });
});

describe("where a review gap shows", () => {
  test("the board's milestone notes name the task with no review, and the one whose review is open", async () => {
    const { repo, data, head } = await reviewing();
    await recordTask(repo, { milestone: "B2", task: "4 manifest", commit: head.slice(0, 7) }, data, NOW);
    await recordReview(repo, data, { milestone: "B2", task: "4 manifest", commit: head, reviewer: "r", verdict: "fix", blocking: 3, summary: "s" });

    const board = await collect(repo, await new Records(repo).readLedger());

    expect(board.rows[0]?.notes).toEqual(expect.arrayContaining(["done: no review", "4 manifest: review-1 open, 3 blocking"]));
  });

  test("the task's context pack names its reviews by id, verdict and blocking count", async () => {
    const { repo, data, head } = await reviewing();
    await recordReview(repo, data, { milestone: "B2", task: "done", commit: head, reviewer: "r", verdict: "fix", blocking: 1, summary: "s" });

    const pack = await contextPack(repo, { level: "task", milestone: "B2", task: "done" });

    expect(pack.parts["reviews"]).toEqual([{ id: "review-1", verdict: "fix", blocking: 1 }]);
    expect(pack.text).toContain("## Reviews\n- review-1: fix, 1 blocking");
  });

  test("land_start's ticket carries a note, not a refusal, while the task has no clear review", async () => {
    const q = await ready();
    const repo = requiring(q.repo);
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: [{ id: "A1", stage: "A", name: "reader", track: "data", weight: 1, tasks: [{ id: "t1", track: "data", status: "planned", also: [] }] }] }, message: "planned" }));
    await sh(q.root, ["add", "-A"]);
    await sh(q.root, ["commit", "-q", "-m", "records: plan"]);
    await edit(q.tree, "src/a.rs");

    const ticket = await joinQueue(repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" } }));

    expect(ticket.note).toBe("this repository requires reviews, and A1 't1' has no review yet; once landed, ledger_check lists it until review_record clears it");
  });

  test("land_start adds no note where reviews are not required", async () => {
    const q = await ready();
    await edit(q.tree, "src/a.rs");

    expect((await joinQueue(q.repo, q.session, landing(["src/a.rs"]))).note).toBeUndefined();
  });
});

describe("closing a phase where reviews are required", () => {
  test("is refused while a landed task has no review, and passes after a waiver", async () => {
    const made = await phased();
    await addPhase(made.repo, OPERATOR, { id: "G", name: "exports", goal: "Ship exports.", weight: 3 });
    const repo = requiring(await made.fresh());
    await milestoneIn(repo, "G", "G1", "data", ["1 csv"]);
    await landedIn(repo, "G1");
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((one) => (one.id !== "G1" ? one : { ...one, tasks: one.tasks.map((task) => ({ ...task, landedAt: NOW.toISOString() })) })) }, message: "stamped" }));

    await expect(closePhase(repo, OPERATOR, { phase: "G", summary: "done" })).rejects.toThrow("G1 '1 csv' landed with no review");
    const operator = (await import("../../src/state/sessions.ts")).openSession(repo, { worktree: made.root, agent: "operator" });
    await recordReview(repo, await operator, { milestone: "G1", task: "1 csv", commit: "HEAD", reviewer: "the operator", verdict: "waived", blocking: 0, summary: "a docs change" });

    expect((await closePhase(repo, OPERATOR, { phase: "G", summary: "done" })).phase.closedAt).toBeDefined();
  });
});

describe("turning reviews on", () => {
  test("fills in from with the present time when it is not given, and keeps an earlier from when turned on again", async () => {
    const { repo, root } = await reviewing(false);
    const config = async () => JSON.parse(await readFile(join(root, "docs/records/config.json"), "utf8")).reviews;

    await configureRepo(await openRepo(root), OPERATOR, { reviews: { required: true } }, NOW);
    await configureRepo(await openRepo(root), OPERATOR, { reviews: { required: true } }, new Date("2026-12-01T00:00:00.000Z"));

    expect(await config()).toEqual({ required: true, from: NOW.toISOString() });
    expect(repo.config.reviews?.required).toBe(false);
  });
});
