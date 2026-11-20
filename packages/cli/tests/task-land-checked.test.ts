import { describe, expect, test } from "vitest";
import { run } from "../src/run.ts";
import type { IO } from "../src/io.ts";
import { Records } from "../../core/src/store/records.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";

function io(cwd: string): IO & { lines: string[]; errors: string[] } {
  const captured = { lines: [] as string[], errors: [] as string[], out: (line: string) => captured.lines.push(line), err: (line: string) => captured.errors.push(line), cwd, env: {}, columns: 120, isTTY: false };
  return captured;
}

describe("tally task land --checked tip", () => {
  test("records that the landing checked its tip only, and refuses any other value", async () => {
    const { repo, root } = await makeTracked();
    const head = await sh(root, ["rev-parse", "--short=7", "HEAD"]);
    const console = io(root);

    expect(await run(["task", "land", "B2", "4 manifest", head, "--checked", "each"], console)).not.toBe(0);
    expect(await run(["task", "land", "B2", "4 manifest", head, "--checked", "tip"], console)).toBe(0);

    expect(console.errors.join("\n")).toContain("--checked takes tip");
    expect((await new Records(repo).readLedger()).milestones[0]?.tasks.find((task) => task.id === "4 manifest")).toMatchObject({ status: "landed", checked: "tip" });
  });
});
