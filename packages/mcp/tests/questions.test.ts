import { describe, expect, test } from "vitest";
import { answerQuestion } from "../../core/src/records/questions.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";

async function serving() {
  const tracked = await makeTracked();
  const { call, client } = await connect(tracked.repo);
  const operator = await opened(call, tracked.root, "operator");
  const data = await opened(call, tracked.trees["data"]!, "claude");
  await call("question_add", { sessionId: data, group: "store", question: "Keep the cache?", meanwhile: "keep it" });
  return { ...tracked, call, client, operator, data };
}

describe("question_add", () => {
  test("answers the question's id, and takes a number from an operator session only", async () => {
    const { call, operator, data } = await serving();

    const jumped = await call("question_add", { sessionId: operator, group: "store", question: "Split?", meanwhile: "no", number: 37 });
    const refused = await call("question_add", { sessionId: data, group: "store", question: "Split?", meanwhile: "no", number: 40 });

    expect(jumped.structured["id"]).toBe("Q-37");
    expect(refused).toMatchObject({ isError: true, text: "only an operator session gives a question its number; leave number out and the next one is taken" });
  });
});

describe("question_list", () => {
  test("puts the id on every row, and finds a row by Q-1, Q-001, 1 and \"1\"", async () => {
    const { call } = await serving();

    const found = await Promise.all(["Q-1", "Q-001", 1, "1"].map(async (id) => ((await call("question_list", { ids: [id] })).structured["open"] as { id: string }[]).map((row) => row.id)));

    expect(found).toEqual([["Q-1"], ["Q-1"], ["Q-1"], ["Q-1"]]);
  });

  test("says how many times a row was edited, and gives the edits only when history is asked for", async () => {
    const { call, data } = await serving();
    await call("question_edit", { sessionId: data, id: "Q-1", question: "Keep the cache as it is?", why: "clearer" });

    const plain = (await call("question_list")).structured["open"] as Record<string, unknown>[];
    const told = (await call("question_list", { history: true })).structured["open"] as Record<string, unknown>[];

    expect(plain[0]).toMatchObject({ id: "Q-1", question: "Keep the cache as it is?", edited: 1 });
    expect(plain[0]).not.toHaveProperty("edits");
    expect(told[0]?.["edits"]).toEqual([expect.objectContaining({ question: "Keep the cache?", why: "clearer", by: "claude" })]);
  });
});

describe("question_edit", () => {
  test("refuses an answered question and an argument it does not have", async () => {
    const { call, operator, repo } = await serving();
    await answerQuestion(repo, 1, "DEC-3", new Date("2026-11-14T11:00:00.000Z"));

    expect(await call("question_edit", { sessionId: operator, id: "Q-1", question: "x", why: "late" })).toMatchObject({ isError: true, text: "Q-1 was answered on 2026-11-14T11:00:00.000Z (DEC-3); ask a new question that names it" });
    const mistyped = await call("question_edit", { sessionId: operator, id: "Q-1", text: "x", why: "late" });
    expect(mistyped.isError).toBe(true);
    expect(mistyped.text).toContain("text");
  });

  test("is listed as an add with a short description", async () => {
    const { client } = await serving();
    const tool = (await client.listTools()).tools.find((one) => one.name === "question_edit");

    expect(tool?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    expect((tool?.description ?? "").length).toBeLessThan(600);
  });
});
