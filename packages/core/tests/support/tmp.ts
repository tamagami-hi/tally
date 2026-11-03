import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";

const made: string[] = [];

export async function tmpDir(prefix = "tally-"): Promise<string> {
  const dir = await mkdtemp(join(process.env["TALLY_TEST_TMP"] ?? tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  }
});
