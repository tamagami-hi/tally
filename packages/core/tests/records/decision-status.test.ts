import { describe, expect, test } from "vitest";
import { answerWithDecision, setStatusBySession } from "../../src/records/decision-status.ts";
import { recordDecision } from "../../src/records/decision-record.ts";
import { addDecision, readDecisions } from "../../src/records/decisions.ts";
import { addQuestion, readQuestions } from "../../src/records/questions.ts";
import { opening } from "../support/opening.ts";

const NOW = new Date("2026-11-21T09:00:00.000Z");

async function withDecision() {
  const made = await opening();
  await recordDecision(made.repo, made.operator, { group: "core", text: "JSON only.", said: "JSON only" }, NOW);
  return made;
}

describe("decision_status", () => {
  test("sets the status and state of a decision found by its id alone, for an operator session only", async () => {
    const { repo, operator, data } = await withDecision();

    await expect(setStatusBySession(repo, data, { id: "DEC-1", status: "built" }, NOW)).rejects.toThrow("only an operator session sets a decision's status; a track says what it built with task_land");
    const { decision } = await setStatusBySession(repo, operator, { id: "DEC-1", status: "built in 0.8.0" }, NOW);

    expect(decision).toMatchObject({ id: "DEC-1", group: "core", status: "built in 0.8.0", state: "built", said: "JSON only" });
  });

  test("names the groups when an id is in more than one, and the ids when it is in none", async () => {
    const { repo, operator } = await withDecision();
    await addDecision(repo, { id: "DEC-1", group: "web", text: "also", since: "2026-11-01", status: "in force" }, { operator: true });

    await expect(setStatusBySession(repo, operator, { id: "DEC-1", status: "built" }, NOW)).rejects.toThrow("DEC-1 is a decision of core and web; give group");
    await expect(setStatusBySession(repo, operator, { id: "DEC-5", status: "built" }, NOW)).rejects.toThrow("no decision DEC-5; the decisions are DEC-1");
    expect((await setStatusBySession(repo, operator, { id: "DEC-1", group: "web", status: "built" }, NOW)).decision.group).toBe("web");
    expect((await readDecisions(repo)).decisions.find((one) => one.group === "core")?.status).toBe("in force");
  });
});

describe("question_answer", () => {
  test("answers an open question with a decision that exists, keeping the operator's words", async () => {
    const { repo, operator, data } = await withDecision();
    await addQuestion(repo, { group: "core", question: "JSON or CSV?", meanwhile: "JSON" });

    await expect(answerWithDecision(repo, data, { id: "Q-1", decision: "DEC-1" }, NOW)).rejects.toThrow("only an operator session answers a question; a track adds what it knows with note_post");
    await expect(answerWithDecision(repo, operator, { id: "Q-1", decision: "DEC-4" }, NOW)).rejects.toThrow("no decision DEC-4; the decisions are DEC-1");
    await expect(answerWithDecision(repo, operator, { id: "Q-2", decision: "DEC-1" }, NOW)).rejects.toThrow("no open question 2");
    await answerWithDecision(repo, operator, { id: "Q-1", decision: "DEC-1", said: "JSON, as decided" }, NOW);

    expect((await readQuestions(repo))?.answered).toEqual([expect.objectContaining({ row: 1, decision: "DEC-1", said: "JSON, as decided", answeredAt: NOW.toISOString() })]);
  });
});
