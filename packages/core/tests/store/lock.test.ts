import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { TallyError } from "../../src/errors.ts";
import { LockBusy, withLock } from "../../src/store/lock.ts";
import { tmpDir } from "../support/tmp.ts";

const BRIEFLY = { retries: 2, minTimeout: 20, maxTimeout: 20 };

describe("taking a lock", () => {
  test("a held lock fails naming the lock, how long it waited, and that nothing was changed", async () => {
    const path = join(await tmpDir(), "locks", "landing.lock");
    const bodies: string[] = [];

    const refused = await withLock(path, () => withLock(path, async () => { bodies.push("ran"); }, BRIEFLY).catch((error: unknown) => error));

    expect(refused).toBeInstanceOf(LockBusy);
    expect(refused).toBeInstanceOf(TallyError);
    expect((refused as Error).message).toMatch(/^could not take the lock landing\.lock after waiting \d+\.\d s: another process holds it, and nothing was changed$/);
    expect(bodies).toEqual([]);
  });

  test("a body's own failure passes through untouched and the lock is free again", async () => {
    const path = join(await tmpDir(), "ledger.json");

    await expect(withLock(path, async () => { throw new Error("the body failed"); })).rejects.toThrow("the body failed");

    expect(await withLock(path, async () => "free")).toBe("free");
  });
});
