import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { changedPaths, entriesOf, statusEntries } from "../../src/git/status.ts";
import { makeRepo, sh } from "../support/repo.ts";

describe("reading git status in its -z form", () => {
  test("keeps a rename's original path beside its new one, and reads a path with a space whole", () => {
    const status = " M b c.txt\0R  d.txt\0a.txt\0?? new file.txt\0";

    expect(entriesOf(status)).toEqual([
      { code: " M", path: "b c.txt" },
      { code: "R ", path: "d.txt", from: "a.txt" },
      { code: "??", path: "new file.txt" },
    ]);
  });

  test("lists every path a change touches, a rename's two included", () => {
    expect(changedPaths([{ code: "R ", path: "d.txt", from: "a.txt" }, { code: "??", path: "e.txt" }])).toEqual(["d.txt", "a.txt", "e.txt"]);
  });

  test("reads a real checkout, untracked files listed one by one", async () => {
    const repo = await makeRepo();
    await repo.commit("src/a.txt", "a\n", "feat: a");
    await sh(repo.root, ["mv", "src/a.txt", "src/b.txt"]);
    await mkdir(join(repo.root, "notes"));
    await writeFile(join(repo.root, "notes", "my plan.md"), "x\n");

    expect(await statusEntries(repo.root)).toEqual([
      { code: "R ", path: "src/b.txt", from: "src/a.txt" },
      { code: "??", path: "notes/my plan.md" },
    ]);
  });
});
