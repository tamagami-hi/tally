import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readReviews, recordReview } from "../../src/records/reviews.ts";
import { reviewing } from "../support/reviews.ts";

const TEXT = "# Review of B2 done\n\nOne finding blocks: the cache is never cleared.\n";

describe("a review given as text", () => {
  test("is written under .temp/tally/reviews by the review's id, and kept as its report by hash", async () => {
    const { repo, data, head } = await reviewing(false);

    const { review } = await recordReview(repo, data, { milestone: "B2", task: "done", commit: head, reviewer: "a reader", verdict: "fix", blocking: 1, summary: "the cache is never cleared", text: TEXT });

    const path = join(repo.root, ".temp", "tally", "reviews", `${review.id}.md`);
    expect(await readFile(path, "utf8")).toBe(TEXT);
    expect(review.report).toEqual({ path, sha256: createHash("sha256").update(TEXT).digest("hex"), bytes: Buffer.byteLength(TEXT) });
  });

  test("is refused beside a report, over 20,000 characters, or empty, and nothing is recorded", async () => {
    const { repo, data, head, report } = await reviewing(false);
    const input = { milestone: "B2", task: "done", commit: head, reviewer: "a reader", verdict: "land" as const, blocking: 0, summary: "fine" };

    await expect(recordReview(repo, data, { ...input, text: TEXT, report })).rejects.toThrow("give the review as text or as a report file, not both");
    await expect(recordReview(repo, data, { ...input, text: "x".repeat(20_001) })).rejects.toThrow("a review's text holds at most 20000 characters; this one has 20001");
    await expect(recordReview(repo, data, { ...input, text: "  " })).rejects.toThrow("a review's text needs some text; leave it out to give none");
    expect((await readReviews(repo)).reviews).toEqual([]);
  });
});
