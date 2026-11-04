import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import lockfile from "proper-lockfile";
import { TallyError } from "../errors.ts";

const RETRIES = { retries: 120, minTimeout: 50, maxTimeout: 250 };
const MS_PER_SECOND = 1000;

export const LANDING_RETRIES = { retries: 3600, minTimeout: 250, maxTimeout: 250 };

export class LockBusy extends TallyError {
  constructor(path: string, waitedMs: number) {
    super(`could not take the lock ${basename(path)} after waiting ${(waitedMs / MS_PER_SECOND).toFixed(1)} s: another process holds it, and nothing was changed`);
    this.name = "LockBusy";
  }
}

async function take(path: string, retries: typeof RETRIES): Promise<() => Promise<void>> {
  const started = Date.now();
  try {
    return await lockfile.lock(path, { realpath: false, retries, stale: 30_000 });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") throw new LockBusy(path, Date.now() - started);
    throw error;
  }
}

export async function withLock<T>(path: string, body: () => Promise<T>, retries = RETRIES): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const release = await take(path, retries);
  try {
    return await body();
  } finally {
    await release();
  }
}
