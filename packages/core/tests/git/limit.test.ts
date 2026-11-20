import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { GIT_LIMIT_MS, GIT_LONG_LIMIT_MS, git, gitMust, limitOf } from "../../src/git/run.ts";
import { withLock } from "../../src/store/lock.ts";
import { tmpDir } from "../support/tmp.ts";

const SHORT_MS = 300;

async function sleepingGit(): Promise<NodeJS.ProcessEnv> {
  const bin = await tmpDir("tally-bin-");
  const fake = join(bin, "git");
  await writeFile(fake, "#!/bin/sh\nexec sleep 30\n");
  await chmod(fake, 0o755);
  return { ...process.env, PATH: `${bin}:${process.env["PATH"] ?? ""}` };
}

describe("a git call that does not end", () => {
  test("is stopped at its limit and fails, saying so", async () => {
    const env = await sleepingGit();
    const started = Date.now();

    const result = await git(await tmpDir(), ["status"], env, SHORT_MS);

    expect(Date.now() - started).toBeLessThan(5_000);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("did not end within 0.3 s");
  });

  test("fails the operation that waited on it, which releases the lock it held", async () => {
    const env = await sleepingGit();
    const dir = await tmpDir();
    const lock = join(dir, "landing.lock");

    await expect(withLock(lock, () => gitMust(dir, ["rebase", "main"], env, SHORT_MS))).rejects.toThrow(/did not end within/);

    expect(await withLock(lock, async () => "taken again")).toBe("taken again");
  });

  test("has a longer limit for what can take long in a large repository", () => {
    expect(limitOf(["status", "--porcelain"])).toBe(GIT_LIMIT_MS);
    expect(limitOf(["-c", "core.hooksPath=/dev/null", "worktree", "add", "x"])).toBe(GIT_LONG_LIMIT_MS);
    expect(limitOf(["rebase", "main"])).toBe(GIT_LONG_LIMIT_MS);
    expect(GIT_LONG_LIMIT_MS).toBeGreaterThan(GIT_LIMIT_MS);
  });
});
