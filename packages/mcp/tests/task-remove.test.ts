import { describe, expect, test } from "vitest";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";
import { withDefaults } from "./support/hints.ts";

async function serving() {
  const { repo, trees } = await makeTracked();
  const { call, client } = await connect(repo);
  return { call, client, data: await opened(call, trees["data"]!, "claude"), engine: await opened(call, trees["engine"]!, "kiro") };
}

const tasksOf = async (call: Awaited<ReturnType<typeof serving>>["call"]): Promise<string[]> => {
  const rows = (await call("board_get")).structured["rows"] as { tasks: { id: string }[] }[];
  return rows.flatMap((row) => row.tasks.map((task) => task.id));
};

describe("task_remove", () => {
  test("removes a planned task of the session's own track, and the board no longer shows it", async () => {
    const { call, data } = await serving();

    const removed = await call("task_remove", { sessionId: data, milestone: "B2", task: "5 transcoder", why: "folded into the manifest" });

    expect(removed.isError).toBe(false);
    expect(removed.structured).toMatchObject({ message: "B2 '5 transcoder': removed (folded into the manifest)", released: null, evidenceKept: 0, done: true });
    expect(await tasksOf(call)).toEqual(["4 manifest", "T9 store", "done"]);
  });

  test("releases the claim the session held on it", async () => {
    const { call, data } = await serving();
    await call("task_claim", { sessionId: data, milestone: "B2", task: "5 transcoder" });

    const removed = await call("task_remove", { sessionId: data, milestone: "B2", task: "5 transcoder", why: "dropped" });

    expect((removed.structured["released"] as { task: string }).task).toBe("5 transcoder");
    expect((await call("board_get")).structured["claims"]).toEqual([]);
  });

  test("refuses another track's task, a landed task, and a call with no reason", async () => {
    const { call, data, engine } = await serving();

    const foreign = await call("task_remove", { sessionId: engine, milestone: "B2", task: "5 transcoder", why: "dropped" });
    const landed = await call("task_remove", { sessionId: data, milestone: "B2", task: "done", why: "dropped" });
    const silent = await call("task_remove", { sessionId: data, milestone: "B2", task: "5 transcoder" });

    expect(foreign.text).toContain("may not write track data's records");
    expect(landed.text).toContain("'done' in B2 landed at abc1234: a landed task is the record of its commit and stays");
    expect(silent.isError).toBe(true);
    expect(await tasksOf(call)).toContain("5 transcoder");
  });

  test("says to the client that it removes", async () => {
    const { client } = await serving();

    const tool = (await client.listTools()).tools.find((one) => one.name === "task_remove");

    expect(withDefaults(tool?.annotations)).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tool?.title).toBe("Remove a planned task");
  });
});
