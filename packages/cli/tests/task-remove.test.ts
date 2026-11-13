import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import type { IO } from "../src/io.ts";
import { run } from "../src/run.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

interface Captured extends IO {
  lines: string[];
  errors: string[];
}

function io(cwd: string): Captured {
  const captured: Captured = { lines: [], errors: [], out: (line) => captured.lines.push(line), err: (line) => captured.errors.push(line), cwd, env: {}, columns: 120, isTTY: false };
  return captured;
}

const ledgerOf = (root: string): Promise<string> => readFile(join(root, "docs/records/ledger.json"), "utf8");

describe("tally task remove", () => {
  test("removes a planned task and prints what it did", async () => {
    const { root } = await makeTracked();
    const out = io(root);

    const exit = await run(["task", "remove", "B2", "5 transcoder", "--why", "folded into the manifest"], out);

    expect(exit).toBe(0);
    expect(out.lines[0]).toBe("B2 '5 transcoder': removed (folded into the manifest)");
    expect(await ledgerOf(root)).not.toContain("5 transcoder");
  });

  test("needs a reason, and says how to give one", async () => {
    const { root } = await makeTracked();
    const out = io(root);

    const exit = await run(["task", "remove", "B2", "5 transcoder"], out);

    expect(exit).toBe(2);
    expect(out.errors[0]).toBe("tally task remove <milestone> <task> --why REASON: say why the task is removed");
    expect(await ledgerOf(root)).toContain("5 transcoder");
  });

  test("leaves a landed task, and exits 1", async () => {
    const { root } = await makeTracked();
    const out = io(root);

    const exit = await run(["task", "remove", "B2", "done", "--why", "a mistake"], out);

    expect(exit).toBe(1);
    expect(out.errors[0]).toContain("'done' in B2 landed at abc1234");
  });

  test("is in the command's own help", async () => {
    const { root } = await makeTracked();
    const out = io(root);

    await run(["task", "--help"], out);

    expect(out.lines.join("\n")).toContain("tally task   remove <milestone> <task> --why REASON");
  });
});
