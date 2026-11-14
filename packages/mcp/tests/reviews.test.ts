import { describe, expect, test } from "vitest";
import { landedAt, requiring } from "../../core/tests/support/reviews.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { connect, opened } from "./support/connect.ts";

async function serving(required = true) {
  const tracked = await makeTracked();
  const repo = requiring(tracked.repo, required);
  await landedAt(repo, "done", "2026-11-14T10:00:00.000Z");
  await landedAt(repo, "5 transcoder", "2026-11-14T11:00:00.000Z");
  const { call, client } = await connect(repo);
  return { ...tracked, repo, call, client, head: await sh(tracked.root, ["rev-parse", "HEAD"]), operator: await opened(call, tracked.root, "operator"), data: await opened(call, tracked.trees["data"]!, "claude") };
}

const FIX = { milestone: "B2", task: "done", reviewer: "a second model", verdict: "fix", blocking: 2, findings: { medium: 1, low: 7 }, summary: "two leaks" };

describe("review_record", () => {
  test("records a review and answers it with the task's state and the records commit", async () => {
    const { call, data, head } = await serving();

    const recorded = await call("review_record", { sessionId: data, ...FIX, commit: head });

    expect(recorded.isError).toBe(false);
    expect(recorded.structured).toMatchObject({ review: { id: "review-1", verdict: "fix", blocking: 2, commit: head.slice(0, 7) }, state: "open", commit: null });
  });

  test("refuses a waiver from a track session in words that say what to do, and an argument it does not have", async () => {
    const { call, data, head } = await serving();

    expect(await call("review_record", { sessionId: data, ...FIX, commit: head, verdict: "waived", blocking: 0 })).toMatchObject({ isError: true, text: "only an operator session records a waiver; ask with question_add" });
    const mistyped = await call("review_record", { sessionId: data, ...FIX, commit: head, severity: "high" });
    expect(mistyped.isError).toBe(true);
    expect(mistyped.text).toContain("severity");
  });

  test("refuses a verdict it does not know, naming the four", async () => {
    const { call, data, head } = await serving();

    const refused = await call("review_record", { sessionId: data, ...FIX, commit: head, verdict: "maybe" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/land.*fix.*stop.*waived/);
  });
});

describe("review_list", () => {
  test("answers the reviews newest first with matched, and the landed tasks that still need a clear review", async () => {
    const { call, data, operator, head } = await serving();
    await call("review_record", { sessionId: data, ...FIX, commit: head });
    await call("review_record", { sessionId: operator, ...FIX, task: "4 manifest", verdict: "land", blocking: 0, commit: head });

    const listed = await call("review_list", { fields: ["id", "task", "verdict"] });

    expect(listed.structured).toEqual({
      reviews: [{ id: "review-2", task: "4 manifest", verdict: "land" }, { id: "review-1", task: "done", verdict: "fix" }],
      matched: 2,
      needing: { tasks: ["B2 '5 transcoder' (no review)", "B2 'done' (review-1 open, 2 blocking)"], total: 2 },
    });
  });

  test("keeps the reviews of tasks in the state asked for, and says nothing of needing where reviews are not required", async () => {
    const { call, data, head } = await serving(false);
    await call("review_record", { sessionId: data, ...FIX, commit: head });

    const clear = await call("review_list", { state: "clear" });
    const open = await call("review_list", { state: "open", limit: 1 });

    expect(clear.structured).toEqual({ reviews: [], matched: 0 });
    expect(open.structured["matched"]).toBe(1);
  });

  test("is listed as a read, and review_record as an add, each with a short description", async () => {
    const { client } = await serving();
    const tools = (await client.listTools()).tools;
    const named = (name: string) => tools.find((tool) => tool.name === name);

    expect(named("review_list")?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(named("review_record")?.annotations).toEqual({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false });
    for (const name of ["review_list", "review_record"]) expect((named(name)?.description ?? "").length, name).toBeLessThan(600);
  });
});

describe("the board and the needing list, by track", () => {
  test("board_get with scope mine keeps the track's own review notes", async () => {
    const { call, data } = await serving();

    const rows = (await call("board_get", { scope: "mine", sessionId: data })).structured["rows"] as { notes: string[] }[];

    expect(rows[0]?.notes).toEqual(expect.arrayContaining(["done: no review", "5 transcoder: no review"]));
  });

  test("needing keeps to the milestone and track asked for", async () => {
    const { call } = await serving();

    expect((await call("review_list", { track: "engine" })).structured["needing"]).toEqual({ tasks: [], total: 0 });
  });
});

describe("ledger_check where reviews are required", () => {
  test("lists a landed task with no review as a gap", async () => {
    const { call } = await serving();

    expect((await call("ledger_check")).structured["gaps"]).toEqual(expect.arrayContaining([expect.stringContaining("B2 'done' landed with no review")]));
  });
});
