import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { endTrial } from "../../src/trials/end.ts";
import { readTrials, trialsFile } from "../../src/trials/file.ts";
import { startTrial } from "../../src/trials/start.ts";
import { sh } from "../support/repo.ts";
import { AT, trialling } from "../support/trialling.ts";

async function recordSays(made: Awaited<ReturnType<typeof trialling>>, change: Record<string, string>) {
  await startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT, 1);
  await trialsFile(made.repo).update((trials) => ({ value: { ...trials, trials: trials.trials.map((one) => ({ ...one, ...change })) }, result: undefined }));
}

describe("a trial's removal checks its record against the trial's own name", () => {
  test("refuses a record naming another folder, and removes nothing", async () => {
    const made = await trialling();
    const other = join(made.root, ".temp", "not-a-trial");
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "keep.txt"), "keep\n");
    await recordSays(made, { worktree: other });

    await expect(endTrial(made.repo, made.operator, "both")).rejects.toThrow(`the record of the trial both names the folder ${other} and the branch trial/both, not its own ${made.folder("both")} and trial/both; nothing was removed: mend or remove its entry in the service's trials.json`);
    expect(await readdir(other)).toEqual(["keep.txt"]);
    expect((await readTrials(made.repo)).trials).toHaveLength(1);
  });

  test("refuses a record naming a branch outside trial/, and removes nothing", async () => {
    const made = await trialling();
    await recordSays(made, { branch: "track/data" });

    await expect(endTrial(made.repo, made.operator, "both")).rejects.toThrow("names the folder");
    expect(await sh(made.root, ["branch", "--list", "track/data"])).not.toBe("");
  });

  test("says what was left when git keeps the branch, and keeps the record so the end can be tried again", async () => {
    const made = await trialling();
    await startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT);
    await sh(made.root, ["worktree", "add", "-q", "--force", join(made.root, ".temp", "elsewhere"), "trial/both"]);

    const ended = await endTrial(made.repo, made.operator, "both");

    expect(ended).toMatchObject({ name: "both", removed: { worktree: made.folder("both") }, left: [expect.stringContaining("the branch trial/both")] });
    expect(ended.removed).not.toHaveProperty("branch");
    expect(await made.hasBranch("both")).toBe(true);
    expect((await readTrials(made.repo)).trials.map((one) => one.name)).toEqual(["both"]);
  });
});
