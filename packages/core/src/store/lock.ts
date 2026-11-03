import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import lockfile from "proper-lockfile";

const RETRIES = { retries: 120, minTimeout: 50, maxTimeout: 250 };

export async function withLock<T>(path: string, body: () => Promise<T>): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const release = await lockfile.lock(path, { realpath: false, retries: RETRIES, stale: 30_000 });
  try {
    return await body();
  } finally {
    await release();
  }
}
