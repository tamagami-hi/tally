import { describe, expect, test } from "vitest";
import { checkLedger } from "../../src/ledger/audit.ts";
import { reviewGaps } from "../../src/ledger/review-gaps.ts";
import { recordReview, readReviews } from "../../src/records/reviews.ts";
import { ledgerSchema } from "../../src/schema/ledger.ts";
import { Records } from "../../src/store/records.ts";
import { ledgerSchema as previousLedgerSchema } from "../fixtures/ledger-0.1.ts";
import { landedAt, requiring, reviewing } from "../support/reviews.ts";

const NONE = "B2 'done' landed with no review: record one with review_record; if it needs none, an operator session records the verdict waived with the reason";

describe("the review gaps", () => {
  test("name a landed task with no review, and one whose newest review has blocking findings", async () => {
    const { repo, data, head } = await reviewing();
    const none = (await checkLedger(repo, await new Records(repo).readLedger())).check.gaps;
    const open = await recordReview(repo, data, { milestone: "B2", task: "done", commit: head, reviewer: "r", verdict: "stop", blocking: 1, summary: "s" });

    const after = (await checkLedger(repo, await new Records(repo).readLedger())).check.gaps;

    expect(none).toContain(NONE);
    expect(after).toContain(`B2 'done' has ${open.review.id} with 1 blocking finding and no later review: record the follow-up with review_record (follows: ${open.review.id})`);
    expect(after).not.toContain(NONE);
  });

  test("leave out a task that landed before reviews were required, and one with no landing time", async () => {
    const { repo } = await reviewing();
    await landedAt(repo, "done", "2026-11-13T23:59:59.000Z");
    await landedAt(repo, "4 manifest", undefined);
    const ledger = await new Records(repo).readLedger();

    expect(reviewGaps(ledger, (await readReviews(repo)).reviews, repo.config.reviews)).toEqual([]);
  });

  test("are none while reviews are not required", async () => {
    const { repo } = await reviewing(false);
    const ledger = await new Records(repo).readLedger();

    expect(reviewGaps(ledger, [], repo.config.reviews)).toEqual([]);
    expect(reviewGaps(ledger, [], undefined)).toEqual([]);
    expect((await checkLedger(requiring(repo, false), ledger)).check.gaps).not.toContain(NONE);
  });

  test("leave a ledger the previous release still reads, landing time and all", async () => {
    const { repo } = await reviewing();
    const written = ledgerSchema.parse(await new Records(repo).readLedger());

    const previous = previousLedgerSchema.parse(JSON.parse(JSON.stringify(written)));

    expect(previous.milestones[0]?.tasks.find((task) => task.id === "done")).toMatchObject({ status: "landed", commit: "abc1234" });
    expect(written.milestones[0]?.tasks.find((task) => task.id === "done")?.landedAt).toBe("2026-11-14T10:00:00.000Z");
  });
});
