import { writeFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";
import { Watcher } from "../src/watcher.ts";
import { closingPath } from "../../core/src/cycles/file.ts";
import { landingLockPath } from "../../core/src/records/commit.ts";
import { isPresent } from "../../core/src/tracks/file.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { delay, holding, pendingClose } from "../../core/tests/support/pending.ts";

describe("the watcher's pass", () => {
  test("finishes a close of a cycle left part way", async () => {
    const { repo } = await cycling();
    await pendingClose({ repo });
    const watcher = new Watcher(repo, { intervalMs: 50 });

    watcher.start();
    try {
      await vi.waitFor(async () => expect(await isPresent(closingPath(repo.recordsDir, 1))).toBe(false), { timeout: 4_000, interval: 100 });
    } finally {
      await watcher.stop();
    }
  });

  test("skips its pass while a close is being finished elsewhere, which is no failure, and finishes it once the lock is free", async () => {
    const { repo } = await cycling();
    await pendingClose({ repo });
    const held = await holding(landingLockPath(repo));
    const watcher = new Watcher(repo, { intervalMs: 50 });

    watcher.start();
    try {
      await delay(400);
      expect(watcher.lastFailure).toBeUndefined();
      expect(await isPresent(closingPath(repo.recordsDir, 1))).toBe(true);
      await held.release();
      await vi.waitFor(async () => expect(await isPresent(closingPath(repo.recordsDir, 1))).toBe(false), { timeout: 4_000, interval: 100 });
    } finally {
      await watcher.stop();
    }
  });

  test("says why when a pending close cannot be finished, as the repository's problem and not on stderr at each pass", async () => {
    const { repo } = await cycling();
    await pendingClose({ repo });
    await writeFile(closingPath(repo.recordsDir, 1), "{ not json");
    const said: string[] = [];
    const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: string | Uint8Array) => {
      said.push(String(chunk));
      return true;
    });
    const watcher = new Watcher(repo, { intervalMs: 50 });

    watcher.start();
    try {
      await vi.waitFor(() => expect(watcher.lastFailure).toContain("a cycle close is being finished and could not be finished now"), { timeout: 4_000, interval: 100 });
      await delay(400);
    } finally {
      await watcher.stop();
      spy.mockRestore();
    }
    expect(said.filter((line) => line.includes("could not finish the close"))).toEqual([]);
  });
});
