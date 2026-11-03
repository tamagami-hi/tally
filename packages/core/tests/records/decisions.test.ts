import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { addDecision, importDecisions, readDecisions, replaceDecision, setDecisionStatus } from "../../src/records/decisions.ts";
import { makeTracked } from "../support/tracked.ts";

const DECISIONS = `# Decisions

## 1. The platform

| id | decision | since | status |
| --- | --- | --- | --- |
| PRJ-1 | **A backtesting platform.** | the operator, 2026-10-28 | decided, not built: [the plan](plan.md) |
| SID-3 | **Keys spelled as built.** | the operator | in force: \`registry::key\` (A2) |
`;

const NOW = new Date("2026-11-04T10:00:00Z");

describe("decision verbs", () => {
  test("add takes the operator's word only, keeps ids unique within a group, and records who and when", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(root, "d.md"), DECISIONS);
    await importDecisions(repo, join(root, "d.md"), "platform");
    await expect(addDecision(repo, { id: "PRJ-9", group: "platform", text: "**Scope.**", since: "the operator, 2026-11-04", status: "in force" }, { operator: false })).rejects.toThrow("a decision is the operator's; pass --operator to record one");
    const { decision } = await addDecision(repo, { id: "PRJ-9", group: "platform", section: "1. The platform", text: "**Scope.**", since: "the operator, 2026-11-04", status: "in force: PRJ-9" }, { operator: true }, NOW);
    expect(decision).toEqual({ id: "PRJ-9", group: "platform", section: "1. The platform", text: "**Scope.**", since: "the operator, 2026-11-04", status: "in force: PRJ-9", state: "in force", by: "operator", on: "2026-11-04T10:00:00.000Z" });
    await expect(addDecision(repo, { id: "PRJ-9", group: "platform", text: "x", since: "x", status: "x" }, { operator: true })).rejects.toThrow("platform already has decision PRJ-9; replace it instead");
    const file = await readDecisions(repo);
    expect(file.decisions.map((d) => d.id)).toEqual(["PRJ-1", "SID-3", "PRJ-9"]);
  });

  test("replace moves the old row to the replaced list with the date and the reason, and takes its place", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(root, "d.md"), DECISIONS);
    await importDecisions(repo, join(root, "d.md"), "platform");
    await expect(replaceDecision(repo, { id: "PRJ-1", group: "platform", text: "x", since: "x", status: "x", why: "x" }, { operator: false })).rejects.toThrow(/pass --operator/);
    await expect(replaceDecision(repo, { id: "PRJ-7", group: "platform", text: "x", since: "x", status: "x", why: "x" }, { operator: true })).rejects.toThrow("platform has no decision PRJ-7; known: PRJ-1, SID-3");
    const { decision, replaced } = await replaceDecision(repo, { id: "PRJ-1", group: "platform", text: "**A backtesting and replay platform.**", since: "the operator, 2026-11-04", status: "partly built in A7", why: "The operator widened the scope." }, { operator: true }, NOW);
    expect(decision).toMatchObject({ id: "PRJ-1", text: "**A backtesting and replay platform.**", state: "partly built", by: "operator", on: "2026-11-04T10:00:00.000Z" });
    expect(replaced).toEqual({ id: "PRJ-1", group: "platform", was: "**A backtesting platform.**", replaced: "2026-11-04, by PRJ-1", why: "The operator widened the scope." });
    const file = await readDecisions(repo);
    expect(file.decisions.map((d) => [d.id, d.section])).toEqual([["PRJ-1", "1. The platform"], ["SID-3", "1. The platform"]]);
    expect(file.replaced).toHaveLength(1);
  });

  test("setStatus changes only the status and its state, naming who recorded it", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(root, "d.md"), DECISIONS);
    await importDecisions(repo, join(root, "d.md"), "platform");
    const { decision } = await setDecisionStatus(repo, { id: "PRJ-1", group: "platform", status: "built in A7 (`19a7c3b`)" }, { by: "data" }, NOW);
    expect(decision).toMatchObject({ id: "PRJ-1", text: "**A backtesting platform.**", status: "built in A7 (`19a7c3b`)", state: "built", by: "data", on: "2026-11-04T10:00:00.000Z" });
    await expect(setDecisionStatus(repo, { id: "ENG-1", group: "engine", status: "x" }, { by: "operator" })).rejects.toThrow("engine has no decision ENG-1; known: none");
    const file = await readDecisions(repo);
    expect(file.decisions.find((d) => d.id === "SID-3")?.by).toBeUndefined();
  });
});
