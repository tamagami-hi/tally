import { describe, expect, test } from "vitest";
import { cycling } from "../../core/tests/support/cycling.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

async function serving() {
  const made = await cycling();
  const repo = keepingContextAsRecords(made.repo);
  const { call, client } = await connect(repo);
  return { ...made, repo, call, client, operator: await opened(call, made.root, "operator-two") };
}

describe("an unknown key inside a nested input", () => {
  test("is refused by name with the keys that object takes, in a planned task, a deliverable and a replacement", async () => {
    const { call, operator } = await serving();

    const task = await call("task_plan", { sessionId: operator, milestone: "A2", tasks: [{ id: "3 typo", cite: ["note-2"] }] });
    const deliverable = await call("milestone_add", { sessionId: operator, id: "A9", stage: "C", name: "x", track: "eng", weight: 1, delivers: [{ id: "a", what: "the a", whatever: true }] });
    const replacement = await call("decision_record", { sessionId: operator, group: "core", text: "x", said: "y", id: "DEC-1", replaces: { why: "z", when: "now" } });

    expect(task).toMatchObject({ isError: true });
    expect(task.text).toContain("tasks.0 takes no 'cite'; it takes id, brief, paths, covers, cites, accept");
    expect(deliverable.text).toMatch(/delivers\.0 takes no 'whatever'; it takes id, what/);
    expect(replacement.text).toContain("replaces takes no 'when'; it takes why");
  });

  test("leaves the listed schemas as they were, with no additionalProperties false at any depth", async () => {
    const { client } = await serving();

    const listed = JSON.stringify((await client.listTools()).tools);

    expect(listed).not.toContain('"additionalProperties":false');
  });
});
