import { describe, expect, test } from "vitest";
import { addQuestion } from "../../core/src/records/questions.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, keepingContextAsRecords } from "./support/connect.ts";

const DAY = 86_400_000;

async function withOldQuestion(days: number) {
  const tracked = await makeTracked();
  const repo = keepingContextAsRecords(tracked.repo);
  await addQuestion(repo, { group: "core", question: "which way", meanwhile: "wait" }, undefined, new Date(Date.now() - days * DAY));
  const { call } = await connect(repo);
  return { ...tracked, call };
}

describe("the oldest open question, as a hint", () => {
  test("board_get and an operator session's brief name it once it is older than 2 days", async () => {
    const { call, root } = await withOldQuestion(3.2);

    const board = (await call("board_get", { rows: "open" })).structured;
    const brief = (await call("session_open", { worktree: root, agent: "operator", brief: "work" })).structured["brief"] as Record<string, unknown>;

    expect(board["oldestQuestion"]).toEqual({ id: "Q-1", days: 3 });
    expect(brief["oldestQuestion"]).toEqual({ id: "Q-1", days: 3 });
  });

  test("is left out of a track session's brief, and out of both while the question is young", async () => {
    const old = await withOldQuestion(3.2);
    const young = await withOldQuestion(1);

    const trackBrief = (await old.call("session_open", { worktree: old.trees["data"], agent: "claude", brief: "work" })).structured["brief"] as Record<string, unknown>;
    const board = (await young.call("board_get", { rows: "open" })).structured;
    const brief = (await young.call("session_open", { worktree: young.root, agent: "operator", brief: "work" })).structured["brief"] as Record<string, unknown>;

    expect(trackBrief).not.toHaveProperty("oldestQuestion");
    expect(board).not.toHaveProperty("oldestQuestion");
    expect(brief).not.toHaveProperty("oldestQuestion");
  });
});
