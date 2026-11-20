import { describe, expect, test } from "vitest";
import { disputedProblems, isWithdrawn, markDecision, recordDecision, toConfirm } from "../../src/records/decision-record.ts";
import { setStatusBySession } from "../../src/records/decision-status.ts";
import { addDecision, readDecisions, setDecisionStatus, type Decision } from "../../src/records/decisions.ts";
import { AT, cycling } from "../support/cycling.ts";

const THREE_WAYS = "it stops being disputed when it is replaced with decision_record, confirmed by the operator on the board, or withdrawn: a status that begins with withdrawn";

async function disputed() {
  const made = await cycling();
  const { decision } = await recordDecision(made.repo, made.operator, { group: "core", text: "ship on Fridays", said: "ship on Fridays" }, AT);
  await markDecision(made.repo, { group: "core", id: decision.id }, "dispute", AT);
  return { ...made, id: decision.id };
}

const standing = async (made: Awaited<ReturnType<typeof disputed>>) => {
  const file = await readDecisions(made.repo);
  return { state: file.decisions.find((one) => one.id === made.id)?.state, problems: disputedProblems(file).length, toConfirm: toConfirm(file).length };
};

describe("a disputed decision", () => {
  test("refuses a status that is not a withdrawal, even one holding the word, and stays a problem and a decision to confirm", async () => {
    const made = await disputed();

    await expect(setStatusBySession(made.repo, made.operator, { id: made.id, status: "in force (not withdrawn)" })).rejects.toThrow(`${made.id} (core) is disputed: ${THREE_WAYS}`);
    await expect(setStatusBySession(made.repo, made.operator, { id: made.id, status: "withdrawn", state: "in force" })).rejects.toThrow("a status that begins with withdrawn takes the state other; leave state out, or give other");

    expect(await standing(made)).toEqual({ state: "in force", problems: 1, toConfirm: 1 });
  });

  test("is withdrawn by a status that begins with withdrawn, which stores the state other", async () => {
    const made = await disputed();

    await setStatusBySession(made.repo, made.operator, { id: made.id, status: "Withdrawn: Fridays are quiet" });

    expect(await standing(made)).toEqual({ state: "other", problems: 0, toConfirm: 0 });
  });
});

describe("withdrawn, decided in one place", () => {
  test("is a status that begins with withdrawn, in any case, with the state other", () => {
    const decision = { id: "DEC-1", group: "core", text: "t", since: "s", by: "operator", on: AT.toISOString() } as Decision;

    expect([
      isWithdrawn({ ...decision, status: "withdrawn", state: "other" }),
      isWithdrawn({ ...decision, status: "WITHDRAWN 2026-11-21", state: "other" }),
      isWithdrawn({ ...decision, status: "in force (not withdrawn)", state: "other" }),
      isWithdrawn({ ...decision, status: "withdrawn", state: "in force" }),
    ]).toEqual([true, true, false, false]);
  });

  test("the command line's status setting stores other for a withdrawal, and refuses a state that says otherwise", async () => {
    const { repo } = await cycling();
    await addDecision(repo, { id: "DEC-9", group: "core", text: "by hand", since: "2026-11-21", status: "in force" }, { operator: true });

    const { decision } = await setDecisionStatus(repo, { id: "DEC-9", group: "core", status: "withdrawn" }, { by: "operator" });

    expect(decision.state).toBe("other");
    await expect(setDecisionStatus(repo, { id: "DEC-9", group: "core", status: "withdrawn", state: "built" }, { by: "operator" })).rejects.toThrow("a status that begins with withdrawn takes the state other; leave state out, or give other");
  });
});
