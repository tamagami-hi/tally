import { describe, expect, test } from "vitest";
import { addQuestion, answerQuestion, questionId, readQuestions, rowOf } from "../../src/records/questions.ts";
import { editQuestion } from "../../src/records/question-edit.ts";
import { questionsFileSchema as previousQuestions } from "../fixtures/questions-0.1.ts";
import { makeTracked } from "../support/tracked.ts";

const OPERATOR = { agent: "operator", operator: true };
const CLAUDE = { agent: "claude", operator: false };
const ASKED = new Date("2026-11-14T09:00:00.000Z");

async function asked() {
  const { repo } = await makeTracked();
  const first = await addQuestion(repo, { group: "store", question: "Keep the cache?", meanwhile: "keep it", by: "claude" }, CLAUDE, ASKED);
  return { repo, first };
}

describe("a question's id", () => {
  test("is Q- and its row, and Q-24, Q-024, 24 and the number all name row 24", () => {
    expect(questionId(24)).toBe("Q-24");
    expect(["Q-24", "Q-024", "q-24", "24", " 24 ", 24].map(rowOf)).toEqual([24, 24, 24, 24, 24, 24]);
  });

  test("refuses anything else and shows the forms", () => {
    expect(() => rowOf("Q-x")).toThrow("'Q-x' is not a question's id; give it as Q-24 or 24");
    expect(() => rowOf(0)).toThrow("'0' is not a question's id; give it as Q-24 or 24");
  });

  test("is answered by question_add, and its commit subject says Q-", async () => {
    const { first } = await asked();

    expect(first.id).toBe("Q-1");
  });
});

describe("a question's number", () => {
  test("may jump forward from an operator, so tally lines up with a plan's numbering", async () => {
    const { repo } = await asked();

    const jumped = await addQuestion(repo, { group: "store", question: "Split the reader?", meanwhile: "one reader", number: 37 }, OPERATOR);
    const next = await addQuestion(repo, { group: "store", question: "And the writer?", meanwhile: "one writer" }, OPERATOR);

    expect([jumped.id, next.id]).toEqual(["Q-37", "Q-38"]);
  });

  test("never goes back, and the refusal gives the next one", async () => {
    const { repo } = await asked();

    await expect(addQuestion(repo, { group: "store", question: "q", meanwhile: "m", number: 1 }, OPERATOR)).rejects.toThrow("the next question number is 2; a number may jump forward, never back or to one used before");
  });

  test("is an operator session's to give", async () => {
    const { repo } = await asked();

    await expect(addQuestion(repo, { group: "store", question: "q", meanwhile: "m", number: 40 }, CLAUDE)).rejects.toThrow("only an operator session gives a question its number; leave number out and the next one is taken");
  });

  test("holds a question and its meanwhile to 2,000 characters", async () => {
    const { repo } = await asked();

    await expect(addQuestion(repo, { group: "store", question: "q".repeat(2001), meanwhile: "m" }, CLAUDE)).rejects.toThrow("a question holds at most 2000 characters; this one has 2001");
  });
});

describe("editing a question", () => {
  test("keeps what it said before, with when, who and why, oldest first", async () => {
    const { repo } = await asked();
    const at = new Date("2026-11-14T10:00:00.000Z");

    await editQuestion(repo, CLAUDE, { id: "Q-1", question: "Keep the cache as it is?", why: "clearer" }, at);
    const edited = await editQuestion(repo, OPERATOR, { id: "1", meanwhile: "keep it, unread", why: "the plan's words" }, at);

    expect(edited.question).toMatchObject({ question: "Keep the cache as it is?", meanwhile: "keep it, unread" });
    expect(edited.question.edits).toEqual([
      { at: at.toISOString(), by: "claude", question: "Keep the cache?", meanwhile: "keep it", why: "clearer" },
      { at: at.toISOString(), by: "operator", question: "Keep the cache as it is?", meanwhile: "keep it", why: "the plan's words" },
    ]);
  });

  test("refuses an answered question, saying when it was answered", async () => {
    const { repo } = await asked();
    await answerQuestion(repo, 1, "DEC-3", new Date("2026-11-14T11:00:00.000Z"));

    await expect(editQuestion(repo, OPERATOR, { id: "Q-1", question: "x", why: "late" })).rejects.toThrow("Q-1 was answered on 2026-11-14T11:00:00.000Z (DEC-3); ask a new question that names it");
  });

  test("refuses another track's agent, and an edit that changes nothing", async () => {
    const { repo } = await asked();

    await expect(editQuestion(repo, { agent: "kiro", operator: false }, { id: "Q-1", question: "x", why: "mine" })).rejects.toThrow("only an operator session or claude, who asked Q-1, edits it; ask a new question that names it");
    await expect(editQuestion(repo, CLAUDE, { id: "Q-1", why: "nothing" })).rejects.toThrow("an edit gives the question, the meanwhile, or both");
  });

  test("leaves a file the previous release still reads", async () => {
    const { repo } = await asked();
    await editQuestion(repo, CLAUDE, { id: "Q-1", question: "Keep the cache as it is?", why: "clearer" });

    const previous = previousQuestions.parse(JSON.parse(JSON.stringify(await readQuestions(repo))));

    expect(previous.open[0]).toMatchObject({ row: 1, question: "Keep the cache as it is?" });
  });
});
