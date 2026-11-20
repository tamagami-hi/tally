import { describe, expect, test, vi } from "vitest";
import { Watcher } from "../src/watcher.ts";
import { closingPath } from "../../core/src/cycles/file.ts";
import { planClose } from "../../core/src/cycles/plan.ts";
import { writeJsonAtomic } from "../../core/src/store/json.ts";
import { closeOpened } from "../../core/src/tracks/close.ts";
import { isPresent } from "../../core/src/tracks/file.ts";
import { AT, cycling } from "../../core/tests/support/cycling.ts";

const BY = { track: "main", agent: "operator" };

describe("the watcher's pass", () => {
  test("finishes a close of a cycle left part way", async () => {
    const { repo } = await cycling();
    await closeOpened(repo, "docs", { by: BY, now: AT, why: "cycle 1 closed", commit: false });
    await writeJsonAtomic(closingPath(repo.recordsDir, 1), await planClose(repo, { by: BY, now: AT, input: { summary: "done", said: "close it" } }));
    const watcher = new Watcher(repo, { intervalMs: 50 });

    watcher.start();
    try {
      await vi.waitFor(async () => expect(await isPresent(closingPath(repo.recordsDir, 1))).toBe(false), { timeout: 4_000, interval: 100 });
    } finally {
      await watcher.stop();
    }
  });
});
