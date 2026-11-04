import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

const RETRIES = { retries: 120, minTimeout: 50, maxTimeout: 250 };

export const LANDING_RETRIES = { retries: 3600, minTimeout: 250, maxTimeout: 250 };

export async function withLock<T>(path: string, body: () => Promise<T>, retries = RETRIES): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const release = await lockfile.lock(path, { realpath: false, retries, stale: 30_000 });
  try {
    return await body();
  } finally {
    await release();
  }
}
