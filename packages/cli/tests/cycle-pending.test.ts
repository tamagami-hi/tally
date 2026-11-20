import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readCycles } from "../../core/src/cycles/file.ts";
import { landingLockPath } from "../../core/src/records/commit.ts";
import { Records } from "../../core/src/store/records.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { holding, isPending, pendingClose } from "../../core/tests/support/pending.ts";
import type { IO } from "../src/io.ts";
import { run } from "../src/run.ts";

interface Captured extends IO {
  lines: string[];
  errors: string[];
}

async function io(cwd: string): Promise<Captured> {
  const home = await mkdtemp(join(tmpdir(), "tally-home-"));
  const captured: Captured = { lines: [], errors: [], out: (line) => captured.lines.push(line), err: (line) => captured.errors.push(line), cwd, env: { TALLY_HOME: home }, columns: 120, isTTY: false };
  return captured;
}

const WAIT = ["task", "wait", "A2", "2 write", "the page"];

async function waitsOf(made: Awaited<ReturnType<typeof cycling>>): Promise<string | undefined> {
  return (await new Records(made.repo).readLedger()).milestones.find((one) => one.id === "A2")?.tasks[0]?.waits;
}

describe("a writing command while a cycle close is pending", () => {
  test("refuses and changes nothing while the close is being finished elsewhere", async () => {
    const made = await cycling({ commit: false });
    await pendingClose(made);
    const held = await holding(landingLockPath(made.repo));
    const console = await io(made.root);

    const code = await run(WAIT, console);
    await held.release();

    expect(code).toBe(1);
    expect(console.errors.join("\n")).toContain("a cycle close is being finished: try again in a moment");
    expect(await waitsOf(made)).toBeUndefined();
    expect(await isPending(made.repo)).toBe(true);
  });

  test("finishes the close first when it can, and then does its work", async () => {
    const made = await cycling();
    await pendingClose(made);
    const console = await io(made.root);

    const code = await run(WAIT, console);

    expect(code).toBe(0);
    expect(await isPending(made.repo)).toBe(false);
    expect((await readCycles(made.repo.recordsDir)).current).toBe(2);
    expect(await waitsOf(made)).toBe("the page");
  });

  test("a reading command is not held up by a pending close", async () => {
    const made = await cycling();
    await pendingClose(made);
    const held = await holding(landingLockPath(made.repo));
    const console = await io(made.root);

    const code = await run(["ledger", "check"], console);
    await held.release();

    expect(console.errors.join("\n")).not.toContain("a cycle close is being finished");
    expect(code).not.toBe(2);
  });
});
