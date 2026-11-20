import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { writeJsonAtomic } from "../../src/store/json.ts";
import { addQuestion } from "../../src/records/questions.ts";
import { sh } from "../support/repo.ts";
import { tmpDir } from "../support/tmp.ts";
import { makeTracked } from "../support/tracked.ts";

describe("a write that fails", () => {
  test("leaves no temporary file behind when the rename fails", async () => {
    const dir = await tmpDir();
    const target = join(dir, "value.json");
    await mkdir(target);
    await writeFile(join(target, "inside"), "a folder where the file should be");

    await expect(writeJsonAtomic(target, { n: 1 })).rejects.toThrow();

    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  test("leaves no temporary file behind when the folder cannot be written", async () => {
    const dir = await tmpDir();
    const blocker = join(dir, "not-a-folder");
    await writeFile(blocker, "a file where the folder should be");

    await expect(writeJsonAtomic(join(blocker, "value.json"), { n: 1 })).rejects.toThrow();

    expect((await readdir(dir)).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });
});

describe("a records commit", () => {
  test("does not take in a temporary file a crashed write left in the records folder", async () => {
    const { repo, root } = await makeTracked({ commit: true });
    await writeFile(join(repo.recordsDir, "ledger.json.4242.tmp"), "{ half a write");

    const { commit } = await addQuestion(repo, { group: "platform", question: "Which store?", meanwhile: "the file store" });

    expect(commit).not.toBeNull();
    const files = (await sh(root, ["show", "--name-only", "--format=", "HEAD"])).split("\n");
    expect(files).toContain("docs/records/questions.json");
    expect(files.filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect(await sh(root, ["status", "--porcelain", "--", "docs/records"])).toContain("ledger.json.4242.tmp");
  });
});
