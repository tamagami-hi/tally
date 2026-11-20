import { describe, expect, test } from "vitest";
import { land, plan } from "../../src/ledger/ops.ts";
import { addQuestion, answerQuestion } from "../../src/records/questions.ts";
import { underOf } from "../../src/records/under.ts";
import type { Ledger } from "../../src/schema/ledger.ts";
import { makeTracked } from "../support/tracked.ts";

const asking = (question: string) => ({ group: "core", question, meanwhile: "wait" });

const base = (): Ledger => ({
  schema: 1,
  baseline: "d0ff4a5",
  milestones: [{ id: "B2", stage: "B", name: "store", track: "data", weight: 1, tasks: [{ id: "one", track: "data", status: "planned", also: [] }] }],
  other: [],
});

describe("work built under an open question", () => {
  test("names open questions as Q-<n>, whether given as 3 or Q-3, each once", async () => {
    const { repo } = await makeTracked();
    for (const text of ["first", "second", "third"]) await addQuestion(repo, asking(text));

    expect(await underOf(repo, ["3", "Q-1", "q-3"])).toEqual(["Q-3", "Q-1"]);
  });

  test("refuses, by name, an id that is not an open question, and lists the open ones", async () => {
    const { repo } = await makeTracked();
    await addQuestion(repo, asking("first"));
    await addQuestion(repo, asking("second"));
    await answerQuestion(repo, 1, "DEC-1");

    await expect(underOf(repo, ["Q-2", "Q-1"])).rejects.toThrow("Q-1 is not an open question; open: Q-2");
    await expect(underOf(repo, ["Q-9"])).rejects.toThrow("Q-9 is not an open question; open: Q-2");
  });

  test("is kept on a task planned with it, set again by its details, and kept when the task lands", async () => {
    const planned = plan(base(), { milestone: "B2", track: "data", tasks: [{ id: "two", under: ["Q-3"] }, { id: "one", under: ["Q-1", "Q-3"] }] }).ledger;
    const landed = (await land(planned, { milestone: "B2", task: "two", commit: "abc1234" }, async (commit) => commit)).ledger;
    const marked = (await land(landed, { milestone: "B2", task: "one", commit: "def5678", under: ["Q-4"] }, async (commit) => commit)).ledger;

    const tasks = marked.milestones[0]!.tasks;
    expect(tasks.find((task) => task.id === "two")).toMatchObject({ status: "landed", under: ["Q-3"] });
    expect(tasks.find((task) => task.id === "one")).toMatchObject({ status: "landed", under: ["Q-4"] });
  });
});
