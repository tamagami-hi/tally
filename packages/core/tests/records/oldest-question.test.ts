import { describe, expect, test } from "vitest";
import { oldestQuestion } from "../../src/records/oldest-question.ts";
import { addQuestion, changeQuestions } from "../../src/records/questions.ts";
import { makeTracked } from "../support/tracked.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-11-21T10:00:00.000Z");
const ago = (days: number): Date => new Date(NOW.getTime() - days * DAY);
const asking = (question: string) => ({ group: "core", question, meanwhile: "wait" });

describe("the oldest open question", () => {
  test("is not named while every open question is 2 days old or less", async () => {
    const { repo } = await makeTracked();
    await addQuestion(repo, asking("young"), undefined, ago(2));

    expect(await oldestQuestion(repo, NOW)).toBeUndefined();
  });

  test("is named with its age in whole days once it is older than 2 days, the oldest of several", async () => {
    const { repo } = await makeTracked();
    await addQuestion(repo, asking("older"), undefined, ago(3.5));
    await addQuestion(repo, asking("oldest"), undefined, ago(6.2));
    await addQuestion(repo, asking("young"), undefined, ago(1));

    expect(await oldestQuestion(repo, NOW)).toEqual({ id: "Q-2", days: 6 });
  });

  test("waits as long as questions.nudgeDays says, and passes over a question with no time it was asked", async () => {
    const { repo } = await makeTracked();
    await addQuestion(repo, asking("four days"), undefined, ago(4));
    await changeQuestions(repo, (file) => ({ file: { ...file, open: [...file.open, { row: 9, group: "core", question: "imported", meanwhile: "wait" }] }, result: undefined }));
    const patient = { ...repo, config: { ...repo.config, questions: { nudgeDays: 5 } } };

    expect(await oldestQuestion(patient, NOW)).toBeUndefined();
    expect(await oldestQuestion({ ...repo, config: { ...repo.config, questions: { nudgeDays: 3 } } }, NOW)).toEqual({ id: "Q-1", days: 4 });
  });
});
