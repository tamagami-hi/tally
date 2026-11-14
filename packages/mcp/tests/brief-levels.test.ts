import { describe, expect, test } from "vitest";
import { putEntry } from "../../core/src/context/entries.ts";
import { setProject } from "../../core/src/context/project.ts";
import { writeHandoff } from "../../core/src/records/handoffs.ts";
import { openSession } from "../../core/src/state/sessions.ts";
import { OPERATOR } from "../../core/tests/support/context.ts";
import { makeTracked } from "../../core/tests/support/tracked.ts";
import { connect, keepingContextAsRecords } from "./support/connect.ts";

const MOST_LAND = 1500;
const RULE_TEXT = "x".repeat(500);

async function heavy() {
  const tracked = await makeTracked();
  const repo = keepingContextAsRecords(tracked.repo);
  await setProject(repo, OPERATOR, { purpose: "p".repeat(1600) });
  for (let index = 0; index < 10; index += 1) await putEntry(repo, OPERATOR, { kind: "rule", title: `Rule ${index}`, text: RULE_TEXT, section: "working", source: "the operator, 2026-11-14" });
  const data = await openSession(repo, { worktree: tracked.trees["data"]!, agent: "claude" });
  await writeHandoff(repo, data, { lines: Array.from({ length: 60 }, (_, index) => `line ${index} of what the next session needs to know`) });
  const { call, client } = await connect(repo);
  return { ...tracked, repo, call, client };
}

describe("session_open's brief levels", () => {
  test("land answers under 1,500 characters in a repository with ten long rules and a 60-line hand-off, and names its level", async () => {
    const { call, trees } = await heavy();

    const opened = await call("session_open", { worktree: trees["data"]!, agent: "claude", brief: "land" });

    expect(opened.isError).toBe(false);
    expect(JSON.stringify(opened.structured).length).toBeLessThan(MOST_LAND);
    expect(opened.structured["brief"]).toMatchObject({ level: "land", rulebook: { rules: 10 } });
  });

  test("full is the default, and holds every rule's text", async () => {
    const { call, trees } = await heavy();

    const opened = await call("session_open", { worktree: trees["data"]!, agent: "claude" });

    expect(opened.structured["brief"]).toMatchObject({ level: "full" });
    expect((opened.structured["brief"] as { rules: { text: string }[] }).rules.every((rule) => rule.text === RULE_TEXT)).toBe(true);
  });

  test("refuses a level it does not know and names the three", async () => {
    const { call, trees } = await heavy();

    const refused = await call("session_open", { worktree: trees["data"]!, agent: "claude", brief: "short" });

    expect(refused.isError).toBe(true);
    expect(refused.text).toMatch(/full.*work.*land/);
  });

  test("says in its description that a lower level leaves the rules' text out", async () => {
    const { client } = await heavy();
    const tool = (await client.listTools()).tools.find((one) => one.name === "session_open");

    expect(tool?.description).toContain("rulebook.changedAt");
    expect(tool?.description).toContain("full brief");
  });
});
