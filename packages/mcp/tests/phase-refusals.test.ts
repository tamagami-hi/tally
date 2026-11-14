import { describe, expect, test } from "vitest";
import { blockersOf, type Context } from "../../core/src/phases/blockers.ts";
import type { Ledger } from "../../core/src/schema/ledger.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect } from "./support/connect.ts";

const LEDGER: Ledger = {
  schema: 1,
  baseline: "abc1234",
  other: [],
  milestones: [{ id: "G1", stage: "G", name: "csv", track: "data", weight: 1, tasks: [{ id: "1 csv", track: "data", status: "planned", also: [] }] }],
};

const CONTEXT: Context = {
  missing: ["def5678 docs: by hand"],
  gaps: [{ milestone: "G1", task: "1 csv", track: "data", text: "G1 '1 csv' landed with no review" }],
  tickets: [{ id: "t-1", sessionId: "s", track: "data", agent: "a", worktree: "/x", files: [], state: "queued", since: "2026-11-14T09:00:00.000Z", attempts: 0 }],
};

const KINDS: readonly { blocker: RegExp; says: string }[] = [
  { blocker: /tasks? (is|are) not landed/, says: "a task of the phase is not landed" },
  { blocker: /the ledger does not record/, says: "a commit the ledger does not record" },
  { blocker: /landed with no review/, says: "ledger_check lists a gap" },
  { blocker: /has a landing in the queue/, says: "one of its tracks is landing" },
];

describe("phase_close's description", () => {
  test("names every kind of blocker blockersOf returns, so it cannot fall behind the code", async () => {
    const blockers = blockersOf(CONTEXT, LEDGER, "G");
    const { client } = await connect((await makeTracked()).repo);
    const description = (await client.listTools()).tools.find((tool) => tool.name === "phase_close")?.description ?? "";

    expect(blockers).toHaveLength(KINDS.length);
    for (const { blocker, says } of KINDS) {
      expect(blockers.some((line) => blocker.test(line)), blocker.source).toBe(true);
      expect(description, says).toContain(says);
    }
    expect(description).toContain("phase_list's `left`");
    expect(description).toContain("`withoutBuildLog`");
  });
});
