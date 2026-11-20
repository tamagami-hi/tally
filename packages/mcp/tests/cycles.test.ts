import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closingPath } from "../../core/src/cycles/file.ts";
import { isPresent } from "../../core/src/tracks/file.ts";
import { cycling } from "../../core/tests/support/cycling.ts";
import { pendingClose } from "../../core/tests/support/pending.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

const SAID = "yes, close cycle one";

async function serving() {
  const made = await cycling();
  const repo = keepingContextAsRecords(made.repo);
  const { call } = await connect(repo);
  return { ...made, repo, call, operator: await opened(call, made.root, "operator") };
}

describe("cycle_list and cycle_close", () => {
  test("cycle_list answers the current cycle complete, and cycle_close closes it from an operator session", async () => {
    const { call, operator } = await serving();

    const listed = await call("cycle_list");
    const closed = await call("cycle_close", { sessionId: operator, summary: "the reader is built", said: SAID });
    const after = await call("cycle_list");

    expect(listed.structured["current"]).toMatchObject({ n: 1, complete: true });
    expect(closed.isError).toBe(false);
    expect(closed.structured).toMatchObject({ cycle: 1, next: 2, archived: { milestones: ["A1"] } });
    expect(after.structured["closed"]).toEqual([expect.objectContaining({ n: 1, summary: "the reader is built" })]);
    expect((await call("cycle_list", { n: 1 })).structured).toMatchObject({ n: 1, said: SAID, totals: { milestones: 1 } });
  });

  test("cycle_close is refused to a track's session, which is told to ask", async () => {
    const { call, root } = await serving();
    const eng = await opened(call, join(root, ".temp/worktrees/eng"), "kiro");

    const refused = await call("cycle_close", { sessionId: eng, summary: "done", said: SAID });

    expect(refused).toMatchObject({ isError: true, text: "only an operator session closes a cycle, on the operator's word; a track that wants one closed asks with question_add" });
  });
});

describe("the nine reads that take a cycle", () => {
  test("read the closed cycle and name it, and refuse the current cycle and one that never was", async () => {
    const { call, operator } = await serving();
    await call("cycle_close", { sessionId: operator, summary: "the reader is built", said: SAID });

    const reads: [string, Record<string, unknown>, string][] = [
      ["board_get", {}, "rows"], ["evidence_list", { milestone: "A1" }, "records"], ["review_list", {}, "reviews"], ["handoff_read", { track: "docs" }, "current"], ["track_list", {}, "tracks"],
      ["phase_list", {}, "phases"], ["activity_get", {}, "events"], ["note_list", { sessionId: operator, state: "all", everyTrack: true }, "notes"], ["deferred_list", {}, "parts"],
    ];
    for (const [tool, args, key] of reads) {
      const answer = await call(tool, { ...args, cycle: 1 });
      expect(answer.isError, `${tool}: ${answer.text}`).toBe(false);
      expect(answer.structured["cycle"], tool).toBe(1);
      expect(answer.structured[key], tool).toBeDefined();
    }
    expect(((await call("board_get", { cycle: 1 })).structured["rows"] as { id: string }[]).map((row) => row.id)).toEqual(["A1"]);
    expect((await call("evidence_list", { milestone: "A1", cycle: 1 })).structured["matched"]).toBe(1);
    expect((await call("board_get", { cycle: 2 })).text).toBe("cycle 2 is the current cycle: leave `cycle` out to read the current cycle");
    expect((await call("board_get", { cycle: 5 })).text).toBe("no closed cycle 5; the closed cycles are 1");
  });
});

describe("the sentence that asks, and the cycle in a brief", () => {
  test("board_get and an operator session's brief carry the cycle and the ask; a track session's brief only its number", async () => {
    const { call, root } = await serving();

    const board = await call("board_get", { fields: ["cycle"] });
    const operatorBrief = await call("session_open", { worktree: root, agent: "operator-two" });
    const trackBrief = await call("session_open", { worktree: join(root, ".temp/worktrees/eng"), agent: "kiro" });

    expect(board.structured["cycle"]).toEqual({ n: 1, complete: true, ask: expect.stringContaining("ask the operator whether to close it") });
    expect((operatorBrief.structured["brief"] as Record<string, unknown>)["cycle"]).toEqual({ n: 1, complete: true, ask: expect.any(String) });
    expect((trackBrief.structured["brief"] as Record<string, unknown>)["cycle"]).toEqual({ n: 1 });
  });
});

describe("a close left part way", () => {
  test("is finished by the next tool call on that repository", async () => {
    const { repo, call } = await serving();
    await pendingClose({ repo });

    const listed = await call("cycle_list");

    expect(await isPresent(closingPath(repo.recordsDir, 1))).toBe(false);
    expect(listed.structured["current"]).toMatchObject({ n: 2 });
  });
});
