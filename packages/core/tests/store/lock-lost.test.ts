import { rm } from "node:fs/promises";
import { join } from "node:path";
import gracefulFs from "graceful-fs";
import { afterEach, describe, expect, test, vi } from "vitest";
import { TallyError } from "../../src/errors.ts";
import { withLock } from "../../src/store/lock.ts";
import { tmpDir } from "../support/tmp.ts";

const PAST_THE_UPDATE_MS = 16_000;
const PATIENCE_ON_A_BUSY_MACHINE_MS = 15_000;

type Callback = (...results: unknown[]) => void;

function heardStatOf(path: string): () => boolean {
  let heard = false;
  const stat = gracefulFs.stat.bind(gracefulFs) as (...args: unknown[]) => void;
  vi.spyOn(gracefulFs, "stat").mockImplementation(((target: unknown, ...rest: unknown[]) => {
    const callback = rest.pop() as Callback;
    stat(target, ...rest, (...results: unknown[]) => {
      callback(...results);
      if (target === path) heard = true;
    });
  }) as typeof gracefulFs.stat);
  return () => heard;
}

async function until(done: () => boolean): Promise<void> {
  const deadline = Date.now() + PATIENCE_ON_A_BUSY_MACHINE_MS;
  while (!done() && Date.now() < deadline) await new Promise((next) => setImmediate(next));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a lock lost while its holder works", () => {
  test("fails that one operation, naming the lock, and the next one takes the lock again", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const path = join(await tmpDir(), "ledger.json");
    let checked = (): boolean => false;

    const outcome = await withLock(path, async () => {
      await rm(`${path}.lock`, { recursive: true, force: true });
      checked = heardStatOf(`${path}.lock`);
      await vi.advanceTimersByTimeAsync(PAST_THE_UPDATE_MS);
      await until(checked);
      return "written";
    }).catch((error: unknown) => error);

    vi.useRealTimers();
    expect(checked()).toBe(true);
    expect(outcome).toBeInstanceOf(TallyError);
    expect((outcome as Error).message).toMatch(/lost the lock ledger\.json/);
    expect(await withLock(path, async () => "taken again")).toBe("taken again");
  });
});
