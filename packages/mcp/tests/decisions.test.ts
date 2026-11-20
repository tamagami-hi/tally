import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { CLOSE_BUSY } from "../../core/src/cycles/finish.ts";
import { landingLockPath } from "../../core/src/records/commit.ts";
import { addDecision, readDecisions } from "../../core/src/records/decisions.ts";
import { addQuestion } from "../../core/src/records/questions.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { opening } from "../../core/tests/support/opening.ts";
import { holding, pendingClose } from "../../core/tests/support/pending.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

const RECORD = { group: "core", text: "The reader reads JSON only.", said: "yes, JSON only" };

async function serving() {
  const made = await opening();
  const repo = keepingContextAsRecords(made.repo);
  const { call } = await connect(repo);
  return { ...made, repo, call, operator: await opened(call, made.root, "operator"), track: await opened(call, made.trees["data"] ?? "", "claude") };
}

describe("decision_record, decision_status and question_answer", () => {
  test("record a decision unconfirmed, which decision_list marks and can keep alone", async () => {
    const { repo, call, operator } = await serving();
    await addDecision(repo, { id: "DEC-1", group: "core", text: "by hand", since: "2026-11-01", status: "in force" }, { operator: true });

    const recorded = await call("decision_record", { sessionId: operator, ...RECORD });
    const all = (await call("decision_list", {})).structured["decisions"] as { id: string; unconfirmed?: boolean }[];
    const only = (await call("decision_list", { unconfirmed: true })).structured["decisions"] as { id: string }[];

    expect(recorded.isError, recorded.text).toBe(false);
    expect(recorded.structured["decision"]).toMatchObject({ id: "DEC-2", said: "yes, JSON only", via: { session: operator } });
    expect(all.map((one) => [one.id, one.unconfirmed === true])).toEqual([["DEC-1", false], ["DEC-2", true]]);
    expect(only.map((one) => one.id)).toEqual(["DEC-2"]);
  });

  test("each refuses a track session and a session that does not exist, writing nothing", async () => {
    const { repo, call, track } = await serving();
    await addQuestion(repo, { group: "core", question: "JSON?", meanwhile: "JSON" });
    await addDecision(repo, { id: "DEC-1", group: "core", text: "by hand", since: "2026-11-01", status: "in force" }, { operator: true });
    const calls: [string, Record<string, unknown>, string][] = [
      ["decision_record", RECORD, "only an operator session records a decision"],
      ["decision_status", { id: "DEC-1", status: "built" }, "only an operator session sets a decision's status"],
      ["question_answer", { id: "Q-1", decision: "DEC-1" }, "only an operator session answers a question"],
    ];

    for (const [tool, args, refusal] of calls) {
      expect((await call(tool, { ...args, sessionId: track })).text, tool).toContain(refusal);
      expect((await call(tool, { ...args, sessionId: "s-nobody" })).isError, tool).toBe(true);
    }
    expect((await readDecisions(repo)).decisions.map((one) => [one.id, one.status])).toEqual([["DEC-1", "in force"]]);
  });

  test("log the verb and the decision's id, and neither the operator's words nor the text", async () => {
    const { repo, call, operator } = await serving();

    await call("decision_record", { sessionId: operator, ...RECORD });
    await call("decision_record", { sessionId: operator, ...RECORD, id: "DEC-1", text: "JSON and CSV.", said: "add CSV", replaces: { why: "CSV came in" } });
    await call("decision_status", { sessionId: operator, id: "DEC-1", status: "built" });

    const day = await readFile(join(repo.recordsDir, "log", `${new Date().toISOString().slice(0, 10)}.json`), "utf8");
    const events = (JSON.parse(day) as { events: { verb: string; target?: string }[] }).events.filter((one) => one.verb.startsWith("decision_"));
    expect(events.map((one) => [one.verb, one.target])).toEqual([["decision_add", "core / DEC-1"], ["decision_replace", "core / DEC-1"], ["decision_status", "core / DEC-1: built"]]);
    expect(day).not.toContain("yes, JSON only");
    expect(day).not.toContain("JSON and CSV.");
  });
});

describe("the three while a cycle close is pending", () => {
  test("are refused like every other write while the close is being finished elsewhere", async () => {
    const made = await cycling({ commit: false });
    const repo = keepingContextAsRecords(made.repo);
    const { call } = await connect(repo);
    const operator = await opened(call, made.root, "operator");
    await pendingClose({ repo });
    const held = await holding(landingLockPath(repo));

    const answers = [await call("decision_record", { sessionId: operator, ...RECORD }), await call("decision_status", { sessionId: operator, id: "DEC-1", status: "built" }), await call("question_answer", { sessionId: operator, id: "Q-1", decision: "DEC-1" })];
    await held.release();

    expect(answers.map((one) => one.text)).toEqual([CLOSE_BUSY, CLOSE_BUSY, CLOSE_BUSY]);
  });
});
