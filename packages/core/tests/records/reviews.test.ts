import { describe, expect, test } from "vitest";
import { readReviews, recordReview, reviewStateOf } from "../../src/records/reviews.ts";
import { LANDED_AT, reviewing } from "../support/reviews.ts";

const REVIEW = { milestone: "B2", task: "done", reviewer: "a second model", verdict: "fix" as const, blocking: 2, findings: { medium: 1, low: 7 }, summary: "two leaks" };

describe("recording a review", () => {
  test("keeps the review with its id, the commit as a short hash, who recorded it and when, and answers the task's state", async () => {
    const { repo, data, head } = await reviewing();

    const done = await recordReview(repo, data, { ...REVIEW, commit: head }, new Date(LANDED_AT));

    expect(done.review).toEqual({ id: "review-1", milestone: "B2", task: "done", track: "data", commit: head.slice(0, 7), reviewer: "a second model", verdict: "fix", blocking: 2, findings: { medium: 1, low: 7 }, summary: "two leaks", by: { track: "data", agent: "claude" }, at: LANDED_AT });
    expect(done.state).toBe("open");
    expect((await readReviews(repo)).reviews).toEqual([done.review]);
  });

  test("turns open into clear with a follow-up that lands", async () => {
    const { repo, data, head } = await reviewing();
    const first = await recordReview(repo, data, { ...REVIEW, commit: head });

    const second = await recordReview(repo, data, { ...REVIEW, commit: head, verdict: "land", blocking: 0, summary: "fixed", follows: first.review.id });

    expect(second.state).toBe("clear");
    expect(reviewStateOf((await readReviews(repo)).reviews, "B2", "done").state).toBe("clear");
  });

  test("keeps a report by its path and hash, never its text", async () => {
    const { repo, data, head, report } = await reviewing();

    const done = await recordReview(repo, data, { ...REVIEW, commit: head, report });

    expect(done.review.report).toEqual({ path: report, sha256: expect.stringMatching(/^[0-9a-f]{64}$/), bytes: 15 });
  });
});

describe("a review that is refused", () => {
  test("names the task when it is not planned, and the track when the session may not write it", async () => {
    const { repo, data, engine, head } = await reviewing();

    await expect(recordReview(repo, data, { ...REVIEW, task: "nope", commit: head })).rejects.toThrow("'nope' is not planned in B2");
    await expect(recordReview(repo, engine, { ...REVIEW, commit: head })).rejects.toThrow(/may not write track data/);
  });

  test("says which numbers each verdict takes when blocking does not fit", async () => {
    const { repo, data, head } = await reviewing();

    await expect(recordReview(repo, data, { ...REVIEW, commit: head, blocking: 0 })).rejects.toThrow("a review with the verdict fix has 0 blocking findings; land and waived take 0, fix and stop take 1 or more");
    await expect(recordReview(repo, data, { ...REVIEW, commit: head, verdict: "land" })).rejects.toThrow("a review with the verdict land has 2 blocking findings; land and waived take 0, fix and stop take 1 or more");
  });

  test("keeps a waiver for an operator session, with no follows", async () => {
    const { repo, data, operator, head } = await reviewing();
    const waiver = { ...REVIEW, commit: head, verdict: "waived" as const, blocking: 0, summary: "a docs change" };

    await expect(recordReview(repo, data, waiver)).rejects.toThrow("only an operator session records a waiver; ask with question_add");
    await expect(recordReview(repo, operator, { ...waiver, follows: "review-1" })).rejects.toThrow("a waiver follows no review; record it without follows");
    expect((await recordReview(repo, operator, waiver)).state).toBe("clear");
  });

  test("names the task's own reviews when follows names another task's or none", async () => {
    const { repo, data, operator, head } = await reviewing();
    const mine = await recordReview(repo, data, { ...REVIEW, commit: head });
    await recordReview(repo, operator, { ...REVIEW, task: "4 manifest", commit: head });

    await expect(recordReview(repo, data, { ...REVIEW, commit: head, follows: "review-2" })).rejects.toThrow(`review-2 is not a review of B2 'done'; its reviews: ${mine.review.id}`);
    await expect(recordReview(repo, operator, { ...REVIEW, task: "5 transcoder", commit: head, follows: "review-9" })).rejects.toThrow("review-9 is not a review of B2 '5 transcoder'; its reviews: none yet");
  });

  test("refuses a commit that does not resolve, and texts and counts past their limits", async () => {
    const { repo, data, head } = await reviewing();

    await expect(recordReview(repo, data, { ...REVIEW, commit: "deadbee" })).rejects.toThrow("deadbee: no such commit in the repository; give the commit the reviewer read");
    await expect(recordReview(repo, data, { ...REVIEW, commit: head, reviewer: "r".repeat(121) })).rejects.toThrow("a review's reviewer holds at most 120 characters; this one has 121");
    await expect(recordReview(repo, data, { ...REVIEW, commit: head, summary: "s".repeat(1001) })).rejects.toThrow("a review's summary holds at most 1000 characters; this one has 1001");
    await expect(recordReview(repo, data, { ...REVIEW, commit: head, findings: Object.fromEntries("abcdefghi".split("").map((k) => [k, 1])) })).rejects.toThrow("a review's findings hold at most 8 counts; these have 9");
  });

  test("refuses a report outside the worktree and the repository's .temp/", async () => {
    const { repo, data, head } = await reviewing();

    await expect(recordReview(repo, data, { ...REVIEW, commit: head, report: "/etc/hostname" })).rejects.toThrow("the report must be inside the session's worktree or the repository's .temp/: /etc/hostname");
  });
});
