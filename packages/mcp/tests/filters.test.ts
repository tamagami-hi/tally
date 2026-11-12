import { describe, expect, test } from "vitest";
import { addDecision, replaceDecision } from "../../core/src/records/decisions.ts";
import { answerQuestion } from "../../core/src/records/questions.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { serving, sessionOn, type Call } from "./support/calling.ts";

async function tracked() {
  const made = await makeTracked();
  const call = await serving(made.repo);
  const data = await sessionOn(call, made.trees["data"]!);
  return { ...made, call, data };
}

describe("question_list filters", () => {
  async function asked() {
    const t = await tracked();
    for (const [group, question] of [["engine", "first?"], ["data", "second?"], ["engine", "third?"], ["engine", "fourth?"], ["data", "fifth?"]]) {
      await t.call("question_add", { sessionId: t.data, group, question, meanwhile: "wait" });
    }
    await answerQuestion(t.repo, 1, "SIM-1");
    await answerQuestion(t.repo, 2, "SRC-1");
    return t;
  }

  const rows = async (call: Call, args: Record<string, unknown>, list = "open"): Promise<number[]> => (((await call("question_list", args)).structured[list] ?? []) as { row: number }[]).map((q) => q.row);

  test("narrows the open rows by ids, by group, and to the most recent", async () => {
    const { call } = await asked();

    expect(await rows(call, {})).toEqual([3, 4, 5]);
    expect(await rows(call, { ids: [5, 3, 1] })).toEqual([3, 5]);
    expect(await rows(call, { group: "engine" })).toEqual([3, 4]);
    expect(await rows(call, { limit: 2 })).toEqual([4, 5]);
    expect(await rows(call, { group: "engine", limit: 1 })).toEqual([4]);
    expect(await rows(call, { ids: [3], group: "data" })).toEqual([]);
  });

  test("narrows the answered rows the same way when they are asked for, and still counts every answered row", async () => {
    const { call } = await asked();

    const narrowed = await call("question_list", { answered: true, group: "engine", limit: 1 });

    expect(await rows(call, { answered: true, ids: [1, 2, 3] }, "answered")).toEqual([1, 2]);
    expect(narrowed.structured).toMatchObject({ nextRow: 6, answeredCount: 2, open: [{ row: 4 }], answered: [{ row: 1 }] });
    expect((await call("question_list", { group: "engine" })).structured).not.toHaveProperty("answered");
  });
});

describe("decision_list limit", () => {
  test("keeps the most recent rows of each list, after the group and ids have narrowed them", async () => {
    const { call, repo } = await tracked();
    const decision = (id: string, group: string) => ({ id, group, text: `**${id}.**`, since: "the operator", status: "in force" });
    for (const [id, group] of [["SIM-1", "engine"], ["SRC-1", "data"], ["SIM-2", "engine"], ["SIM-3", "engine"]]) await addDecision(repo, decision(id!, group!), { operator: true });
    await replaceDecision(repo, { ...decision("SIM-1", "engine"), why: "widened" }, { operator: true });
    await replaceDecision(repo, { ...decision("SIM-3", "engine"), why: "narrowed" }, { operator: true });
    const ids = async (args: Record<string, unknown>): Promise<string[][]> => {
      const { decisions, replaced } = (await call("decision_list", args)).structured as { decisions: { id: string }[]; replaced: { id: string }[] };
      return [decisions.map((d) => d.id), replaced.map((r) => r.id)];
    };

    expect(await ids({})).toEqual([["SIM-1", "SRC-1", "SIM-2", "SIM-3"], ["SIM-1", "SIM-3"]]);
    expect(await ids({ limit: 1 })).toEqual([["SIM-3"], ["SIM-3"]]);
    expect(await ids({ group: "engine", limit: 2 })).toEqual([["SIM-2", "SIM-3"], ["SIM-1", "SIM-3"]]);
    expect(await ids({ ids: ["SIM-1", "SRC-1"], limit: 5 })).toEqual([["SIM-1", "SRC-1"], ["SIM-1"]]);
  });
});

describe("evidence_list filters", () => {
  async function measured() {
    const t = await tracked();
    const run = (kind: string, started: string, exit = 0) => t.call("evidence_record", { sessionId: t.data, milestone: "B2", task: "4 manifest", kind, command: ["check", kind], cwd: ".", started, seconds: 1, exit, note: `${kind} at ${started}` });
    await run("green", "2026-11-04T09:00:00.000Z");
    await run("clippy", "2026-11-04T10:00:00.000Z");
    await run("green", "2026-11-04T11:00:00.000Z");
    await run("fmt", "2026-11-05T08:00:00.000Z");
    return t;
  }

  const notes = async (call: Call, args: Record<string, unknown>): Promise<string[]> => ((await call("evidence_list", { milestone: "B2", ...args })).structured["records"] as { note: string }[]).map((r) => r.note);

  test("narrows by kind, by the time a run started, and to the most recent", async () => {
    const { call } = await measured();

    expect(await notes(call, {})).toHaveLength(4);
    expect(await notes(call, { kind: "green" })).toEqual(["green at 2026-11-04T09:00:00.000Z", "green at 2026-11-04T11:00:00.000Z"]);
    expect(await notes(call, { since: "2026-11-04T10:00:00Z" })).toEqual(["clippy at 2026-11-04T10:00:00.000Z", "green at 2026-11-04T11:00:00.000Z", "fmt at 2026-11-05T08:00:00.000Z"]);
    expect(await notes(call, { limit: 2 })).toEqual(["green at 2026-11-04T11:00:00.000Z", "fmt at 2026-11-05T08:00:00.000Z"]);
    expect(await notes(call, { task: "4 manifest", kind: "green", since: "2026-11-04T09:30:00Z", limit: 3 })).toEqual(["green at 2026-11-04T11:00:00.000Z"]);
    expect(await notes(call, { task: "5 transcoder" })).toEqual([]);
  });

  test("keeps only the named keys of each record", async () => {
    const { call } = await measured();

    const slim = await call("evidence_list", { milestone: "B2", kind: "green", fields: ["kind", "exit", "started", "summary"] });

    expect(slim.structured["records"]).toStrictEqual([{ kind: "green", exit: 0, started: "2026-11-04T09:00:00.000Z" }, { kind: "green", exit: 0, started: "2026-11-04T11:00:00.000Z" }]);
  });

  test("refuses a since that is not a time", async () => {
    const { call } = await measured();

    const refused = await call("evidence_list", { milestone: "B2", since: "yesterday" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toBe("since takes an ISO time such as 2026-11-04T09:00:00Z, not 'yesterday'");
  });
});
