import { describe, expect, test } from "vitest";
import { addDecision } from "../../core/src/records/decisions.ts";
import { withParts } from "../../core/tests/support/deferred.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { sh } from "../../core/tests/support/repo.ts";
import { connect, opened } from "./support/connect.ts";

const PARKED = { why: "polish later", decision: "DEC-14", owner: "the design lead" };

async function serving() {
  const tracked = await makeTracked();
  await addDecision(tracked.repo, { id: "DEC-14", group: "platform", text: "Leftovers wait for polish.", since: "2026-11-10", status: "in force" }, { operator: true });
  await withParts(tracked.repo, "B2", "done", [{ what: "the docs", to: "B2:4 manifest" }, { what: "the cache" }, { what: "the icons", parked: PARKED }]);
  const { call, client } = await connect(tracked.repo);
  return { ...tracked, call, client, operator: await opened(call, tracked.root, "operator"), data: await opened(call, tracked.trees["data"]!, "claude") };
}

describe("deferred_list", () => {
  test("answers each part with its place and state, how many matched, and the counts of the whole ledger", async () => {
    const { call } = await serving();

    const listed = await call("deferred_list", { decision: "DEC-14" });

    expect(listed.structured).toEqual({
      parts: [{ milestone: "B2", task: "done", track: "data", part: 3, what: "the icons", state: "parked", parked: PARKED }],
      matched: 1,
      counts: { unplaced: 1, waiting: 1, done: 0, parked: 1 },
    });
  });

  test("keeps the first parts by limit and only the fields asked for, and refuses an argument it does not have", async () => {
    const { call } = await serving();

    const listed = await call("deferred_list", { limit: 1, fields: ["what", "state"] });
    const mistyped = await call("deferred_list", { colour: "red" });

    expect(listed.structured["parts"]).toEqual([{ what: "the docs", state: "waiting" }]);
    expect(listed.structured["matched"]).toBe(3);
    expect(mistyped.isError).toBe(true);
    expect(mistyped.text).toContain("colour");
  });
});

describe("deferred_set", () => {
  test("parks a part from an operator session and answers it as it was and as it is", async () => {
    const { call, operator } = await serving();

    const set = await call("deferred_set", { sessionId: operator, milestone: "B2", task: "done", part: 2, parked: { why: "not this phase", owner: "ops" } });

    expect(set.isError).toBe(false);
    expect(set.structured).toMatchObject({ before: { what: "the cache" }, after: { what: "the cache", parked: { why: "not this phase", owner: "ops" } }, message: "B2 'done': part 2 (the cache) parked" });
    expect((await call("ledger_check")).structured["parked"]).toBe(2);
  });

  test("refuses a track session that parks without a decision, in words that say who may", async () => {
    const { call, data } = await serving();

    const refused = await call("deferred_set", { sessionId: data, milestone: "B2", task: "done", part: 2, parked: { why: "later" } });

    expect(refused).toMatchObject({ isError: true, text: "an operator session parks a part; or name the decision that covers it" });
  });

  test("refuses a key the parked object does not have", async () => {
    const { call, operator } = await serving();

    const refused = await call("deferred_set", { sessionId: operator, milestone: "B2", task: "done", part: 2, parked: { why: "later", until: "May" } });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("until");
  });
});

describe("parking where a task lands", () => {
  test("task_land takes a parked part under a decision from the task's track", async () => {
    const { call, data, root } = await serving();
    const commit = await sh(root, ["rev-parse", "--short=7", "HEAD"]);

    const landed = await call("task_land", { sessionId: data, milestone: "B2", task: "4 manifest", commit, deferred: [{ what: "the guide", parked: { why: "after review", decision: "DEC-14" } }] });

    expect(landed.isError).toBe(false);
    expect((await call("deferred_list", { state: "parked" })).structured["matched"]).toBe(2);
  });

  test("task_land and land_start refuse a track session that parks with no decision", async () => {
    const { call, data, root } = await serving();
    const commit = await sh(root, ["rev-parse", "--short=7", "HEAD"]);
    const deferred = [{ what: "the guide", parked: { why: "after review" } }];

    const landed = await call("task_land", { sessionId: data, milestone: "B2", task: "4 manifest", commit, deferred });
    const started = await call("land_start", { sessionId: data, milestone: "B2", task: "4 manifest", deferred });

    expect(landed).toMatchObject({ isError: true, text: "an operator session parks a part; or name the decision that covers it" });
    expect(started).toMatchObject({ isError: true, text: "an operator session parks a part; or name the decision that covers it" });
  });
});

describe("the new tools say what they are", () => {
  test("with a title, true hints and a description under 600 characters", async () => {
    const { client } = await serving();
    const tools = (await client.listTools()).tools;
    const named = (name: string) => tools.find((tool) => tool.name === name);

    expect(named("deferred_list")?.annotations).toEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    expect(named("deferred_set")?.annotations).toEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false });
    for (const name of ["deferred_list", "deferred_set"]) {
      expect(named(name)?.title, name).toBeTruthy();
      expect((named(name)?.description ?? "").length, name).toBeLessThan(600);
    }
  });
});
