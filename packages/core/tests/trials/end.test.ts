import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { endTrial } from "../../src/trials/end.ts";
import { readTrials } from "../../src/trials/file.ts";
import { startTrial } from "../../src/trials/start.ts";
import { execFile } from "node:child_process";
import { RUNNER } from "../../src/land/runner.ts";
import { listEvidence } from "../../src/records/evidence.ts";
import { commitOn } from "../support/landing.ts";
import { AT, trialling } from "../support/trialling.ts";

const ranIn = (tree: string, args: readonly string[]): Promise<void> => new Promise((done) => { execFile("sh", [join(tree, RUNNER), ...args], { cwd: tree }, () => done()); });

describe("trial_end", () => {
  test("removes the trial's checkout and branch and its record, and keeps the run logs under the repository's .temp/tally/logs", async () => {
    const made = await trialling();
    await startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT);
    const logs = join(made.root, ".temp/tally/logs/trial-both");
    await mkdir(logs, { recursive: true });
    await writeFile(join(logs, "run.log"), "1 passed\n");

    const ended = await endTrial(made.repo, made.operator, "both");

    expect(ended).toEqual({ name: "both", removed: { worktree: made.folder("both"), branch: "trial/both" } });
    expect([await made.hasBranch("both"), await made.hasFolder("both"), (await readTrials(made.repo)).trials]).toEqual([false, false, []]);
    expect(await readFile(join(logs, "run.log"), "utf8")).toBe("1 passed\n");
  });

  test("refuses while the checkout holds uncommitted work, or the branch has commits beyond the picks, naming them", async () => {
    const made = await trialling();
    await startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT);
    await writeFile(join(made.folder("both"), "src/fix.rs"), "a fix\n");

    await expect(endTrial(made.repo, made.operator, "both")).rejects.toThrow(`the trial both has uncommitted work in ${made.folder("both")}: src/fix.rs; move it to a lane first`);
    await commitOn(made.folder("both"), "src/fix.rs", "fix: made in the trial");
    await expect(endTrial(made.repo, made.operator, "both")).rejects.toThrow(/^the trial both has 1 commit beyond its picks: [0-9a-f]{7} \(fix: made in the trial\); move it to a lane first$/);
    expect(await made.hasFolder("both")).toBe(true);
  });

  test("refuses a name no trial has, naming the open ones, and a track session", async () => {
    const made = await trialling();
    await startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT);

    await expect(endTrial(made.repo, made.operator, "none")).rejects.toThrow("no trial none; trials: both");
    await expect(endTrial(made.repo, made.data, "both")).rejects.toThrow("only an operator session ends a trial");
    expect((await readTrials(made.repo)).trials).toHaveLength(1);
  });

  test("takes the trial's waiting run results first, so their records are made, and then ends", async () => {
    const made = await trialling();
    const trial = await startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT);
    await ranIn(trial.worktree, ["green", "--task", "B2:4 manifest", "--", "true"]);

    await endTrial(made.repo, made.operator, "both");

    expect((await listEvidence(made.repo, "B2", "4 manifest")).map((one) => one.trial?.name)).toEqual(["both"]);
    expect(await made.hasFolder("both")).toBe(false);
  });

  test("refuses, naming it and its problem, while a result is held with a problem, and removes nothing", async () => {
    const made = await trialling();
    const trial = await startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT);
    await ranIn(trial.worktree, ["green", "--task", "B2:9 nothing", "--", "true"]);

    await expect(endTrial(made.repo, made.operator, "both")).rejects.toThrow(/^the trial both holds run results not recorded: \S+ \('9 nothing' is not planned in B2\); mend what each says and let the service take it, or remove it from .*\.temp\/tally\/results, then end the trial again$/);
    expect(await made.hasFolder("both")).toBe(true);
  });
});
