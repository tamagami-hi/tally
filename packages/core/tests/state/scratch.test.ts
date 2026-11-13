import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { openScratch } from "../../src/state/scratch.ts";
import { tmpDir } from "../support/tmp.ts";

describe("a session's scratch folder", () => {
  test("is .temp/<track> inside the worktree, made when it is asked for", async () => {
    const worktree = await tmpDir();

    const folder = await openScratch(worktree, "exports");

    expect(folder).toBe(join(worktree, ".temp", "exports"));
    expect((await stat(folder)).isDirectory()).toBe(true);
  });

  test("keeps what is already in it", async () => {
    const worktree = await tmpDir();
    const folder = await openScratch(worktree, "exports");
    await writeFile(join(folder, "notes.md"), "kept");

    expect(await openScratch(worktree, "exports")).toBe(folder);
    expect((await stat(join(folder, "notes.md"))).size).toBe(4);
  });
});
