import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { carryOut } from "../../src/cycles/carry.ts";
import { closingPath } from "../../src/cycles/file.ts";
import { finishPendingClose } from "../../src/cycles/finish.ts";
import { isPresent } from "../../src/tracks/file.ts";
import { cycling } from "../support/cycling.ts";
import { OPERATIONS, pendingClose } from "../support/pending.ts";
import { sh } from "../support/repo.ts";

type Folder = Map<string, string>;

async function filesOf(dir: string, root = dir): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(entries.map((entry) => (entry.isDirectory() ? filesOf(join(dir, entry.name), root) : Promise.resolve([relative(root, join(dir, entry.name))]))));
  return nested.flat().sort();
}

async function snapshot(dir: string): Promise<Folder> {
  const paths = (await filesOf(dir)).filter((path) => !path.endsWith("closing.json"));
  return new Map(await Promise.all(paths.map(async (path): Promise<[string, string]> => [path, await readFile(join(dir, path), "utf8")])));
}

async function restore(dir: string, folder: Folder): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  for (const [path, text] of folder) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
}

const STEPS = Array.from({ length: OPERATIONS + 1 }, (_, index) => index);

describe("a close killed part way", () => {
  test.each(STEPS)("after %i steps, is finished by the next call exactly as an uninterrupted close, and committed once", async (steps) => {
    const made = await cycling();
    const plan = await pendingClose(made);
    const before = new Map([...(await snapshot(made.repo.recordsDir)), ["cycles/cycle-1/closing.json", await readFile(closingPath(made.repo.recordsDir, 1), "utf8")]]);
    await carryOut(made.repo, plan);
    const uninterrupted = await snapshot(made.repo.recordsDir);
    await restore(made.repo.recordsDir, before);

    await carryOut(made.repo, plan, steps);
    await finishPendingClose(made.repo);

    expect(await snapshot(made.repo.recordsDir)).toEqual(uninterrupted);
    expect(await isPresent(closingPath(made.repo.recordsDir, 1))).toBe(false);
    expect(await sh(made.root, ["log", "-1", "--format=%s%n%b"])).toBe("records: cycle 1 closed\nthe reader is built");
    expect(await sh(made.root, ["status", "--porcelain", "--", "docs/records"])).toBe("");
  });

  test("leaves nothing to do when no close is pending", async () => {
    const { repo, root } = await cycling();
    const head = await sh(root, ["rev-parse", "HEAD"]);

    expect(await finishPendingClose(repo)).toBeUndefined();
    expect(await sh(root, ["rev-parse", "HEAD"])).toBe(head);
  });
});
