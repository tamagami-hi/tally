import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { readNotes } from "../../src/records/notes.ts";
import { addQuestion, answerQuestion } from "../../src/records/questions.ts";
import { builtUnder } from "../../src/records/under.ts";
import { Records } from "../../src/store/records.ts";
import { AT, cycling } from "../support/cycling.ts";
import { CLOSE_INPUT } from "../support/pending.ts";

describe("work built under a question and archived by a close", () => {
  test("is named with its cycle, beside the current work, by builtUnder and by the note sent when the question is answered", async () => {
    const made = await cycling();
    await addQuestion(made.repo, { group: "core", question: "which", meanwhile: "wait" });
    await new Records(made.repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => ({ ...milestone, tasks: milestone.tasks.map((task) => ({ ...task, under: ["Q-1"] })) })) }, message: "under" }));
    await closeCycle(made.repo, made.operator, CLOSE_INPUT, AT);
    const repo = await made.fresh();

    expect(await builtUnder(repo, "Q-1")).toEqual(["A2 '2 write'", "A1 '1 read' (cycle 1)"]);
    await answerQuestion(repo, 1, "DEC-1", AT);
    expect((await readNotes(repo)).notes.filter((note) => note.about?.record === "Q-1").map((note) => note.text)).toEqual(["Q-1 is answered by DEC-1: check the work built under its meanwhile against the answer: A2 '2 write', A1 '1 read' (cycle 1)"]);
  });
});
