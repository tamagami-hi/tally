import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { RESULTS, RUNNER, writeRunner } from "../../src/land/runner.ts";
import { readNotes } from "../../src/records/notes.ts";
import { takeResults } from "../../src/records/results.ts";
import { Records } from "../../src/store/records.ts";
import { AT, cycling } from "../support/cycling.ts";
import { CLOSE_INPUT } from "../support/pending.ts";

const ran = (tree: string, args: readonly string[]): Promise<void> => new Promise((done) => { execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, () => done()); });

describe("a runner's result for a milestone a close archived", () => {
  test("is refused once, naming the cycle, tells its track once, and is not tried again when the ledger changes", async () => {
    const made = await cycling();
    const tree = join(made.root, ".temp/worktrees/data");
    await writeRunner(made.repo, tree, "data");
    await ran(tree, ["green", "--task", "A1:1 read", "--", "true"]);
    await closeCycle(made.repo, made.operator, CLOSE_INPUT, AT);
    const repo = await made.fresh();

    const first = await takeResults(repo);
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, other: [...ledger.other, { commit: made.landed, note: "a later change" }] }, message: "changed" }));
    await new Promise((done) => setTimeout(done, 20));
    const second = await takeResults(repo);

    expect(first.map((one) => one.problem)).toEqual([expect.stringContaining("A1 was archived with cycle 1")]);
    expect(second).toEqual([]);
    expect((await readNotes(repo)).notes.filter((note) => note.text.includes("A1 was archived with cycle 1")).map((note) => note.text)).toEqual([expect.stringContaining("it is not tried again")]);
    expect(await readdir(join(tree, RESULTS, "refused"))).toHaveLength(1);
  });
});
