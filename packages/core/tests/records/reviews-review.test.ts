import { writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { checkLedger } from "../../src/ledger/audit.ts";
import { joinQueue } from "../../src/land/queue.ts";
import { recordReview, reviewsPath } from "../../src/records/reviews.ts";
import { configureRepo } from "../../src/repos/configure.ts";
import { collect } from "../../src/status/collect.ts";
import { Records, openRepo } from "../../src/store/records.ts";
import { OPERATOR } from "../support/context.ts";
import { edit } from "../support/landing.ts";
import { landing, ready } from "../support/queue.ts";
import { sh } from "../support/repo.ts";
import { reviewing } from "../support/reviews.ts";

describe("what Part C's review found", () => {
  test("a commit given as a ref is read in the reviewer's worktree, not the operator checkout", async () => {
    const { repo, data, trees } = await reviewing();
    const tree = trees["data"]!;
    await sh(tree, ["commit", "-q", "--allow-empty", "-m", "feat: on the track"]);
    const trackHead = await sh(tree, ["rev-parse", "--short=7", "HEAD"]);

    const done = await recordReview(repo, data, { milestone: "B2", task: "done", commit: "HEAD", reviewer: "r", verdict: "land", blocking: 0, summary: "s" });

    expect(done.review.commit).toBe(trackHead);
  });

  test("a follow-up of a waiver is refused as that, not as another task's review", async () => {
    const { repo, operator, head } = await reviewing();
    const waiver = await recordReview(repo, operator, { milestone: "B2", task: "done", commit: head, reviewer: "the operator", verdict: "waived", blocking: 0, summary: "docs only" });

    await expect(recordReview(repo, operator, { milestone: "B2", task: "done", commit: head, reviewer: "r", verdict: "land", blocking: 0, summary: "s", follows: waiver.review.id })).rejects.toThrow(`${waiver.review.id} is a waiver, and a waiver is not followed up; record the review without follows`);
  });

  test("reviews.from must be an ISO time", async () => {
    const { root } = await reviewing(false);

    await expect(configureRepo(await openRepo(root), OPERATOR, { reviews: { required: true, from: "soon" } })).rejects.toThrow("reviews.from");
  });

  test("a reviews file that does not parse breaks nothing while reviews are not required", async () => {
    const { repo } = await reviewing(false);
    await writeFile(reviewsPath(repo), "not json");
    const ledger = await new Records(repo).readLedger();

    await expect(checkLedger(repo, ledger)).resolves.toBeDefined();
    await expect(collect(repo, ledger)).resolves.toBeDefined();
  });

  test("land_start reads no reviews where they are not required", async () => {
    const q = await ready();
    await writeFile(reviewsPath(q.repo), "not json");
    await edit(q.tree, "src/a.rs");

    await expect(joinQueue(q.repo, q.session, landing(["src/a.rs"], { target: { milestone: "A1", task: "t1" } }))).resolves.toMatchObject({ state: "queued" });
  });
});
