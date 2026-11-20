import { describe, expect, test } from "vitest";
import { endTrial } from "../../src/trials/end.ts";
import { readTrials } from "../../src/trials/file.ts";
import { startTrial, TRIAL_STEPS } from "../../src/trials/start.ts";
import { AT, trialling } from "../support/trialling.ts";

const INPUT = { name: "both", tracks: ["engine", "data"] };
const STOPS = Array.from({ length: TRIAL_STEPS(3) }, (_, index) => index + 1);

describe("a trial stopped halfway", () => {
  test.each(STOPS)("after %i steps leaves a record, which trial_end cleans whole", async (steps) => {
    const made = await trialling();
    await startTrial(made.repo, made.operator, INPUT, AT, steps);
    expect((await readTrials(made.repo)).trials.map((trial) => trial.name)).toEqual(["both"]);

    await endTrial(made.repo, made.operator, "both");

    expect([await made.hasBranch("both"), await made.hasFolder("both"), (await readTrials(made.repo)).trials]).toEqual([false, false, []]);
  });

  test.each(STOPS.slice(0, -1))("after %i steps is cleaned by the next trial_start of that name, which then makes it whole", async (steps) => {
    const made = await trialling();
    await startTrial(made.repo, made.operator, INPUT, AT, steps);

    const trial = await startTrial(made.repo, made.operator, INPUT, AT);

    expect(await made.subjects("trial/both", 3)).toEqual(["feat: engine", "feat: data one", "feat: data two"]);
    expect((await readTrials(made.repo)).trials).toEqual([expect.objectContaining({ name: "both", state: "open", head: trial.head })]);
  });
});
