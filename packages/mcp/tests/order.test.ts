import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { plan } from "../../core/src/ledger/ops.ts";
import { recordDecision } from "../../core/src/records/decision-record.ts";
import { writeHandoff } from "../../core/src/records/handoffs.ts";
import { openSession } from "../../core/src/state/sessions.ts";
import { Records } from "../../core/src/store/records.ts";
import { AT, cycling } from "../../core/tests/support/cycling.ts";
import { connect, keepingContextAsRecords, opened } from "./support/connect.ts";

const LONG = 9_000;

async function serving(cites: string[]) {
  const made = await cycling();
  const repo = keepingContextAsRecords(made.repo);
  for (const n of [1, 2]) await recordDecision(repo, made.operator, { group: "core", text: `${n}`.repeat(LONG), said: "long", accept: [`decision ${n} holds`] }, AT);
  await new Records(repo).update((ledger) => plan(ledger, { milestone: "A2", track: "eng", tasks: [{ id: "3 order", cites }] }));
  const { call } = await connect(repo);
  return { ...made, repo, call, worktree: join(made.root, ".temp/worktrees/eng") };
}

describe("session_open with brief order", () => {
  test("gives a track session its work order, with the records its tasks cite word for word", async () => {
    const { call, worktree } = await serving(["DEC-1"]);

    const brief = (await call("session_open", { worktree, agent: "kiro", brief: "order" })).structured["brief"] as { level: string; cited: { id: string; text: string; accept: string[] }[] };

    expect(brief.level).toBe("order");
    expect(brief.cited).toEqual([expect.objectContaining({ id: "DEC-1", text: "1".repeat(LONG), accept: ["decision 1 holds"] })]);
  });

  test("cuts other parts to fit, and never the cited records or the rules", async () => {
    const { repo, call, worktree } = await serving(["DEC-1", "DEC-2"]);
    const eng = await openSession(repo, { worktree, agent: "earlier" });
    await writeHandoff(repo, eng, { lines: Array.from({ length: 60 }, (_, n) => `${n} `.padEnd(150, "x")) }, AT);

    const answer = await call("session_open", { worktree, agent: "kiro", brief: "order" });
    const brief = answer.structured["brief"] as { cited: { text: string }[] };

    expect(answer.text).toContain("This answer was cut to fit");
    expect(answer.text).not.toMatch(/brief\.cited/);
    expect(brief.cited.map((one) => one.text.length)).toEqual([LONG, LONG]);
  });

  test("answers an operator session at work, saying it asked for order", async () => {
    const { call, root } = await serving(["DEC-1"]);

    const brief = (await call("session_open", { worktree: root, agent: "operator-two", brief: "order" })).structured["brief"] as Record<string, unknown>;

    expect(brief).toMatchObject({ level: "work", asked: "order" });
  });
});

describe("a builder's report of a difference", () => {
  test("note_post's about.record reaches the main track's inbox", async () => {
    const { call, worktree, root } = await serving(["DEC-1"]);
    const builder = await opened(call, worktree, "kiro");
    const operator = await opened(call, root, "operator-two");

    const posted = await call("note_post", { sessionId: builder, to: ["main"], kind: "request", text: "the brief says CSV, the decision says JSON", record: "DEC-1" });
    const inbox = (await call("inbox_get", { sessionId: operator })).structured["items"] as { text: string }[];

    expect(posted.structured).toMatchObject({ about: { record: "DEC-1" } });
    expect(inbox.map((item) => item.text)).toContainEqual(expect.stringContaining("request from eng (kiro) about DEC-1: the brief says CSV, the decision says JSON"));
  });
});
