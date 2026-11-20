import { mkdir } from "node:fs/promises";
import { basename, dirname } from "node:path";
import lockfile from "proper-lockfile";
import { TallyError } from "../errors.ts";

const RETRIES = { retries: 120, minTimeout: 50, maxTimeout: 250 };
const MS_PER_SECOND = 1000;

export const LANDING_RETRIES = { retries: 3600, minTimeout: 250, maxTimeout: 250 };
const STALE_MS = 30_000;

export class LockBusy extends TallyError {
  constructor(path: string, waitedMs: number) {
    super(`could not take the lock ${basename(path)} after waiting ${(waitedMs / MS_PER_SECOND).toFixed(1)} s: another process holds it, and nothing was changed`);
    this.name = "LockBusy";
  }
}

export class LockLost extends TallyError {
  constructor(path: string, cause: Error) {
    super(`lost the lock ${basename(path)} while this ran (${cause.message}); another process may have taken it, so check what this changed`);
    this.name = "LockLost";
  }
}

type OnLost = (error: Error) => void;

async function take(path: string, retries: typeof RETRIES, onLost: OnLost): Promise<() => Promise<void>> {
  const started = Date.now();
  try {
    return await lockfile.lock(path, { realpath: false, retries, stale: STALE_MS, onCompromised: onLost });
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") throw new LockBusy(path, Date.now() - started);
    throw error;
  }
}

export async function withLock<T>(path: string, body: () => Promise<T>, retries = RETRIES): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  let lost: Error | undefined;
  const release = await take(path, retries, (error) => {
    lost = error;
  });
  try {
    const result = await body();
    if (lost !== undefined) throw new LockLost(path, lost);
    return result;
  } finally {
    await release().catch((error: unknown) => {
      if (lost === undefined) throw error;
    });
  }
}
