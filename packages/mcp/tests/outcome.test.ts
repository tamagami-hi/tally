import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, test } from "vitest";
import { DECORATORS, type Called } from "../src/decorate.ts";
import { outcome } from "../src/decorators/outcome.ts";
import { ok, refused } from "../src/respond.ts";
import type { RepoSource } from "../src/source.ts";
import { busyLock } from "../../core/tests/support/busy.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { serving, sessionOn } from "./support/calling.ts";

const unused = (): Promise<never> => Promise.reject(new Error("the outcome reads no repository"));

const source: RepoSource = { instructions: "", forSession: unused, forWorktree: unused, forRead: unused, listed: unused };

const called = (args: Record<string, unknown>, result: CallToolResult): Called => ({ tool: "task_plan", args, result, source });

const SESSION = { sessionId: "s-1", milestone: "B2" };

describe("the outcome of a writing tool", () => {
  test("says the write is done and names the commit that holds its records", async () => {
    const told = await outcome(called(SESSION, ok({ message: "planned", commit: "abc1234" })));

    expect(told.structuredContent).toStrictEqual({ message: "planned", commit: "abc1234", done: true, records: "abc1234" });
    expect(told.isError).toBeUndefined();
  });

  test("says the records are waiting when no commit was made yet, and keeps commit as it was", async () => {
    const told = await outcome(called(SESSION, ok({ message: "planned", commit: null })));

    expect(told.structuredContent).toStrictEqual({ message: "planned", commit: null, done: true, records: "waiting" });
  });

  test("says the same in the text when the text is the answer itself, and leaves a text of its own alone", async () => {
    const plain = await outcome(called(SESSION, ok({ message: "planned", commit: null })));
    const worded = await outcome(called(SESSION, ok({ message: "planned", commit: null }, "planned two tasks")));

    expect(JSON.parse((plain.content[0] as { text: string }).text)).toStrictEqual(plain.structuredContent);
    expect(worded.content).toEqual([{ type: "text", text: "planned two tasks" }]);
    expect(worded.structuredContent).toMatchObject({ done: true, records: "waiting" });
  });

  test("leaves alone a call with no session, an error, and an answer with no commit of that kind", async () => {
    const untouched: Called[] = [
      called({ repo: "alpha" }, ok({ message: "planned", commit: "abc1234" })),
      called({ sessionId: 7 }, ok({ message: "planned", commit: "abc1234" })),
      called(SESSION, refused(new Error("no milestone 'B9'"))),
      called(SESSION, { ...ok({ message: "half", commit: null }), isError: true }),
      called(SESSION, ok({ task: "4 manifest", agent: "a" })),
      called(SESSION, ok({ message: "odd", commit: 7 })),
      called(SESSION, ok({ message: "odd", commit: undefined })),
      called(SESSION, ok("a plain word")),
    ];

    for (const call of untouched) expect(await outcome(call)).toBe(call.result);
  });

  test("leaves alone a run that says its record was not written", async () => {
    const kept = called(SESSION, ok({ record: { kind: "green" }, recorded: false, commit: null, problem: "nothing was changed" }));
    const written = await outcome(called(SESSION, ok({ record: { kind: "green" }, recorded: true, commit: null })));

    expect(await outcome(kept)).toBe(kept.result);
    expect(written.structuredContent).toMatchObject({ recorded: true, done: true, records: "waiting" });
  });
});

describe("outcomes through the server", () => {
  test("every tool's answer passes through the outcome", () => {
    expect(DECORATORS).toContain(outcome);
  });

  test("a writing tool answers done with the records commit, and waiting when the commit is held back", async () => {
    const made = await makeTracked({ commit: true });
    const call = await serving(made.repo);
    const data = await sessionOn(call, made.trees["data"]!);

    const committed = await call("task_plan", { sessionId: data, milestone: "B2", tasks: ["6 more"] });
    busyLock("landing.lock");
    const held = await call("handoff_write", { sessionId: data, lines: ["a note"] });

    expect(committed.structured).toStrictEqual({ message: "B2: planned 1 new task(s): 6 more", commit: expect.stringMatching(/^[0-9a-f]{7}$/), done: true, records: committed.structured["commit"] });
    expect(JSON.parse(committed.text)).toStrictEqual(committed.structured);
    expect(held.structured).toMatchObject({ commit: null, done: true, records: "waiting" });
  });

  test("a reading tool, a tool that writes no record and a refusal answer as before", async () => {
    const made = await makeTracked();
    const call = await serving(made.repo);
    const data = await sessionOn(call, made.trees["data"]!);

    const board = await call("board_get", { scope: "mine", sessionId: data });
    const claim = await call("task_claim", { sessionId: data, milestone: "B2", task: "4 manifest" });
    const failed = await call("task_plan", { sessionId: data, milestone: "B9", tasks: ["x"] });
    const closed = await call("session_close", { sessionId: data });

    for (const answer of [board, claim, closed]) {
      expect(answer.structured).not.toHaveProperty("done");
      expect(answer.structured).not.toHaveProperty("records");
    }
    expect(failed.isError).toBe(true);
    expect(failed.structured).toEqual({});
    expect(failed.text).toBe("no milestone 'B9'; known: B2");
  });
});
