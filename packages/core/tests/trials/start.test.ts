import { mkdir } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { endTrial } from "../../src/trials/end.ts";
import { readTrials } from "../../src/trials/file.ts";
import { startTrial } from "../../src/trials/start.ts";
import { commitOn } from "../support/landing.ts";
import { sh } from "../support/repo.ts";
import { AT, trialling } from "../support/trialling.ts";

describe("trial_start", () => {
  test("makes trial/<name> at main's tip in a checkout of tally's, and picks each track's commits onto it in the order given", async () => {
    const made = await trialling();

    const trial = await startTrial(made.repo, made.operator, { name: "both", tracks: ["engine", "data"] }, AT);

    expect(trial).toMatchObject({ name: "both", worktree: made.folder("both"), tracks: [{ name: "engine", commits: 1 }, { name: "data", commits: 2 }], runner: `${made.folder("both")}/.temp/tally/run` });
    expect(await made.subjects("trial/both", 3)).toEqual(["feat: engine", "feat: data one", "feat: data two"]);
    expect(trial.head).toBe(await sh(made.folder("both"), ["rev-parse", "HEAD"]));
    expect(await sh(made.folder("both"), ["log", "-1", "--format=%cn"])).toBe("operator");
  });

  test("at a conflict leaves nothing behind, and names the track, the commit and the files", async () => {
    const made = await trialling();
    await commitOn(made.trees["engine"]!, "src/data-one.rs", "feat: engine's own data one", "other\n");

    await expect(startTrial(made.repo, made.operator, { name: "clash", tracks: ["data", "engine"] }, AT)).rejects.toThrow(/^the trial clash stopped at a conflict: track engine's [0-9a-f]{7} \(feat: engine's own data one\) does not apply on the picks before it, in src\/data-one\.rs; nothing of the trial is left$/);
    expect([await made.hasBranch("clash"), await made.hasFolder("clash"), (await readTrials(made.repo)).trials]).toEqual([false, false, []]);
  });

  test("refuses, by name, a branch or a folder of that name it did not make, a track that is not open, and a name that could leave its folder", async () => {
    const made = await trialling();
    await sh(made.root, ["branch", "trial/mine"]);
    await mkdir(made.folder("theirs"), { recursive: true });

    await expect(startTrial(made.repo, made.operator, { name: "mine", tracks: ["data"] }, AT)).rejects.toThrow("a branch trial/mine exists and is not a trial tally made; choose another name, or delete the branch yourself");
    await expect(startTrial(made.repo, made.operator, { name: "theirs", tracks: ["data"] }, AT)).rejects.toThrow(`a folder ${made.folder("theirs")} exists and is not a trial tally made; choose another name, or remove it yourself`);
    await expect(startTrial(made.repo, made.operator, { name: "t", tracks: ["data", "--all"] }, AT)).rejects.toThrow("no open track '--all'; open: data, engine");
    await expect(startTrial(made.repo, made.operator, { name: "../up", tracks: ["data"] }, AT)).rejects.toThrow("'../up' is not a trial's name: it is lower-case letters, digits, '-' and '_', beginning with a letter or a digit");
    expect((await readTrials(made.repo)).trials).toEqual([]);
    expect(await made.hasBranch("mine")).toBe(true);
  });

  test("is an operator session's, and refuses a second trial of an open one's name", async () => {
    const made = await trialling();
    await startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT);

    await expect(startTrial(made.repo, made.data, { name: "other", tracks: ["data"] }, AT)).rejects.toThrow("only an operator session starts a trial");
    await expect(startTrial(made.repo, made.operator, { name: "both", tracks: ["data"] }, AT)).rejects.toThrow("the trial both is open; end it with trial_end first");
    await endTrial(made.repo, made.operator, "both");
  });
});
