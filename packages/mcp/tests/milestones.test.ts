import { describe, expect, test } from "vitest";
import { addMilestone } from "../../core/src/ledger/ops.ts";
import { Records } from "../../core/src/store/records.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, opened } from "./support/connect.ts";
import { withDefaults } from "./support/hints.ts";

async function serving() {
  const { repo, root, trees } = await makeTracked();
  await new Records(repo).update((ledger) => addMilestone(ledger, { id: "B3", stage: "B", name: "cache", track: "data", weight: 1, waits: "the store", delivers: [{ id: "lru", what: "an LRU cache" }] }, ["B"]));
  const { call, client } = await connect(repo);
  return { repo, call, client, operator: await opened(call, root, "operator"), data: await opened(call, trees["data"]!, "claude") };
}

const milestoneOf = async (repo: Awaited<ReturnType<typeof serving>>["repo"], id: string) => (await new Records(repo).readLedger()).milestones.find((one) => one.id === id);

describe("milestone_edit", () => {
  test("renames a milestone, clears its wait and drops a deliverable, from an operator session", async () => {
    const { repo, call, operator } = await serving();

    const edited = await call("milestone_edit", { sessionId: operator, milestone: "B3", name: "the cache", waits: null, drop: [{ id: "lru", why: "the store caches itself" }] });

    expect(edited.isError).toBe(false);
    expect(edited.structured["message"]).toBe("B3: renamed to 'the cache'; no longer waits; dropped lru (the store caches itself)");
    expect(await milestoneOf(repo, "B3")).toMatchObject({ name: "the cache", delivers: [{ id: "lru", dropped: { why: "the store caches itself", by: { track: "main", agent: "operator" } } }] });
    expect((await milestoneOf(repo, "B3"))?.waits).toBeUndefined();
  });

  test("is refused to a track's session", async () => {
    const { call, data } = await serving();

    const refused = await call("milestone_edit", { sessionId: data, milestone: "B3", name: "mine now" });

    expect(refused).toMatchObject({ isError: true, text: "only an operator session edits a milestone; a track asks with question_add" });
  });
});

describe("milestone_remove", () => {
  test("removes a milestone with nothing landed, from an operator session, and is marked as destructive", async () => {
    const { repo, call, client, operator } = await serving();

    const removed = await call("milestone_remove", { sessionId: operator, milestone: "B3", why: "the cache moved on" });

    expect(removed.isError).toBe(false);
    expect(removed.structured["tasks"]).toEqual([]);
    expect(await milestoneOf(repo, "B3")).toBeUndefined();
    const listed = (await client.listTools()).tools.find((tool) => tool.name === "milestone_remove");
    expect(withDefaults(listed?.annotations)["destructiveHint"]).toBe(true);
    expect((listed?.description ?? "").length).toBeLessThanOrEqual(300);
  });

  test("is refused to a track's session", async () => {
    const { call, data } = await serving();

    const refused = await call("milestone_remove", { sessionId: data, milestone: "B3", why: "mine" });

    expect(refused).toMatchObject({ isError: true, text: "only an operator session removes a milestone; a track asks with question_add" });
  });
});
