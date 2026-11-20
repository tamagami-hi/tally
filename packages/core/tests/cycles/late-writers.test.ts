import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { cycleDir } from "../../src/cycles/file.ts";
import { appendBuildlog } from "../../src/records/buildlog.ts";
import { handoffPath, writeHandoff } from "../../src/records/handoffs.ts";
import { recordReview } from "../../src/records/reviews.ts";
import { closeSession, openSession } from "../../src/state/sessions.ts";
import { isPresent } from "../../src/tracks/file.ts";
import { AT, cycling } from "../support/cycling.ts";
import { CLOSE_INPUT, delay } from "../support/pending.ts";

const REPORT_BYTES = 120 * 1024 * 1024;

const reviewsOf = (path: string): Promise<{ id: string; milestone: string }[]> => readFile(path, "utf8").then((text) => (JSON.parse(text) as { reviews: { id: string; milestone: string }[] }).reviews, () => []);

describe("a write naming what a close archives, made after the close", () => {
  test.each([0, 60, 250])("a review of an archived milestone begun before the close ends in the cycle's folder or is refused, never in the current folder (after %i ms)", async (wait) => {
    const made = await cycling();
    await mkdir(join(made.root, ".temp", "reviews"), { recursive: true });
    const report = join(made.root, ".temp", "reviews", "long.md");
    await writeFile(report, Buffer.alloc(REPORT_BYTES, 120));
    const writing = recordReview(made.repo, made.operator, { milestone: "A1", task: "1 read", commit: made.landed, reviewer: "a reader", verdict: "land", blocking: 0, summary: "fine", report }, AT).then((done) => done.review.id, (error: unknown) => String(error));
    await delay(wait);
    await closeCycle(made.repo, made.operator, CLOSE_INPUT, AT);
    const ended = await writing;

    const current = (await reviewsOf(join(made.repo.recordsDir, "reviews.json"))).filter((one) => one.milestone === "A1");
    const archived = (await reviewsOf(join(cycleDir(made.repo.recordsDir, 1), "reviews.json"))).map((one) => one.id);
    expect(current).toEqual([]);
    expect(ended.includes("was archived with cycle 1") || archived.includes(ended)).toBe(true);
  }, 60_000);

  test("a section of the build log for an archived milestone is refused, naming the cycle", async () => {
    const made = await cycling();
    await closeCycle(made.repo, made.operator, CLOSE_INPUT, AT);

    await expect(appendBuildlog(made.repo, { group: "web", milestone: "A1", title: "the reader, late", date: "2026-11-21", markdown: "Built." })).rejects.toThrow("A1 was archived with cycle 1");
    await appendBuildlog(made.repo, { group: "web", milestone: "Z9", title: "no milestone", date: "2026-11-21", markdown: "Free." });
  });

  test("a hand-off from a session the close ended is refused, and the archived track's hand-off is not written again", async () => {
    const made = await cycling();
    const docs = await openSession(made.repo, { worktree: join(made.root, ".temp/worktrees/docs"), agent: "late" });
    await closeSession(made.repo, docs.id);
    await closeCycle(made.repo, made.operator, CLOSE_INPUT, AT);

    await expect(writeHandoff(made.repo, docs, { lines: ["late"] }, AT)).rejects.toThrow(`session ${docs.id} is no longer open`);
    expect(await isPresent(handoffPath(made.repo, "docs"))).toBe(false);
  });
});
