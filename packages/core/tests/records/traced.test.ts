import { describe, expect, test } from "vitest";
import { answerWithDecision, setStatusBySession } from "../../src/records/decision-status.ts";
import { addDecision, readDecisions, setDecisionStatus } from "../../src/records/decisions.ts";
import { addQuestion, answerQuestion, readQuestions } from "../../src/records/questions.ts";
import { AT, cycling } from "../support/cycling.ts";

async function decided() {
  const made = await cycling();
  await addDecision(made.repo, { id: "DEC-1", group: "core", text: "by hand", since: "2026-11-20", status: "decided, not built" }, { operator: true });
  return made;
}

const decisionOne = async (made: Awaited<ReturnType<typeof decided>>) => (await readDecisions(made.repo)).decisions.find((one) => one.id === "DEC-1");

describe("a status change or an answer made over MCP", () => {
  test("a status set by a session keeps statusVia: the session, track, agent and time", async () => {
    const made = await decided();

    await setStatusBySession(made.repo, made.operator, { id: "DEC-1", status: "built" }, AT);

    expect((await decisionOne(made))?.statusVia).toEqual({ session: made.operator.id, track: "main", agent: "operator", at: AT.toISOString() });
  });

  test("the command line's status setting writes none, and leaves no earlier session's statusVia standing", async () => {
    const made = await decided();
    await setStatusBySession(made.repo, made.operator, { id: "DEC-1", status: "built" }, AT);

    await setDecisionStatus(made.repo, { id: "DEC-1", group: "core", status: "in force" }, { by: "operator" });

    expect(await decisionOne(made)).not.toHaveProperty("statusVia");
  });

  test("an answer by a session keeps via on the answered question, and the command line's keeps none", async () => {
    const made = await decided();
    await addQuestion(made.repo, { group: "core", question: "first", meanwhile: "wait" });
    await addQuestion(made.repo, { group: "core", question: "second", meanwhile: "wait" });

    await answerWithDecision(made.repo, made.operator, { id: "Q-1", decision: "DEC-1" }, AT);
    await answerQuestion(made.repo, 2, "DEC-1", AT);

    const answered = (await readQuestions(made.repo))?.answered ?? [];
    expect(answered.map((one) => one.via)).toEqual([{ session: made.operator.id, track: "main", agent: "operator" }, undefined]);
  });
});
