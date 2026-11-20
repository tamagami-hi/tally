import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TallyError } from "../../src/errors.ts";
import { withLock } from "../../src/store/lock.ts";
import { tmpDir } from "../support/tmp.ts";

const PAST_THE_UPDATE_MS = 16_000;
const TURNS = 200;

async function letCallbacksRun(): Promise<void> {
  for (let turn = 0; turn < TURNS; turn += 1) await new Promise((done) => setImmediate(done));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("a lock lost while its holder works", () => {
  test("fails that one operation, naming the lock, and the next one takes the lock again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const path = join(await tmpDir(), "ledger.json");

    const outcome = await withLock(path, async () => {
      await rm(`${path}.lock`, { recursive: true, force: true });
      await vi.advanceTimersByTimeAsync(PAST_THE_UPDATE_MS);
      await letCallbacksRun();
      return "written";
    }).catch((error: unknown) => error);

    vi.useRealTimers();
    expect(outcome).toBeInstanceOf(TallyError);
    expect((outcome as Error).message).toMatch(/lost the lock ledger\.json/);
    expect(await withLock(path, async () => "taken again")).toBe("taken again");
  });
});
