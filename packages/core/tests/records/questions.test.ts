import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { importDecisions, parseDecisions, readDecisions, stateOf } from "../../src/records/decisions.ts";
import { parseTables, renderRow, splitCells } from "../../src/records/markdown.ts";
import { addQuestion, answerQuestion, importAnswered, importQuestions, parseQuestions, readQuestions } from "../../src/records/questions.ts";
import { openQuestions } from "../../src/status/questions.ts";
import { makeTracked } from "../support/tracked.ts";

const DECISIONS = `# Decisions

**How it is kept:** only the operator decides.

## 1. The platform

| id | decision | since | status |
| --- | --- | --- | --- |
| PRJ-1 | **A backtesting platform.** | the operator, 2026-10-28 | decided, not built: [the plan](project-plan.md) |
| SID-3 | **Keys spelled as \`OPT:X:INDEX:2026-11-03:2420000:CE\`** and \`a | b\` inside code. | the operator | in force: \`acme-core::registry::key\` (A2) |
| ENG-7 | **Greeks in Rust,** the forward at the strike where |C − P| is smallest (Cboe's rule). | the operator, 2026-10-29 | built in A3 (\`ed3eada\`) |

## Replaced

| id | was | replaced | why |
| --- | --- | --- | --- |
| STK-3 | "Python for code strategies." | 2026-10-29, by STK-3 | The operator: analytics only. |
`;

const QUESTIONS = `# Questions

**Questions are collected, not asked.** Rows are numbered across every group; the next is 38.

| # | question | conservative behaviour meanwhile |
| --- | --- | --- |
| 36 | **Equity quantity.** Do equity lots mean shares? | **T7b2:** equity runs are refused, naming row 36. |
| 37 | **Day-DTE on matrix runs.** | matrix DTE filters are refused, naming row 37. |
`;

describe("markdown tables", () => {
  test("splits cells, keeping pipes inside code spans, and renders a row back", () => {
    expect(splitCells("| a | \`x | y\` | c |")).toEqual(["a", "`x | y`", "c"]);
    expect(renderRow(["a", "`x | y`", "c"])).toBe("| a | `x | y` | c |");
    const tables = parseTables(DECISIONS);
    expect(tables.map((t) => [t.section, t.header[1], t.rows.length])).toEqual([["1. The platform", "decision", 3], ["Replaced", "was", 1]]);
    expect(tables[0]?.rows[2]?.cells[1]).toBe("**Greeks in Rust,** the forward at the strike where |C − P| is smallest (Cboe's rule).");
  });
});

describe("decisions", () => {
  test("parse every row with its section, derive a state, and render each row back exactly", () => {
    const { decisions, replaced, lines } = parseDecisions(DECISIONS, "platform");
    expect(decisions.map((d) => [d.id, d.state, d.section])).toEqual([["PRJ-1", "decided, not built", "1. The platform"], ["SID-3", "in force", "1. The platform"], ["ENG-7", "built", "1. The platform"]]);
    expect(decisions[1]?.text).toContain("`a | b`");
    expect(replaced).toEqual([{ id: "STK-3", group: "platform", was: '"Python for code strategies."', replaced: "2026-10-29, by STK-3", why: "The operator: analytics only." }]);
    const original = DECISIONS.split("\n");
    for (const { line, rendered } of lines.values()) expect(original[line - 1]).toBe(rendered);
    expect(stateOf("partly built in A5")).toBe("partly built");
    expect(stateOf("built in A3")).toBe("built");
    expect(stateOf("release pipeline in place")).toBe("other");
  });

  test("import writes the group's records, replaces them on a second import, and refuses a lossy read", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(root, "d.md"), DECISIONS);
    const first = await importDecisions(repo, join(root, "d.md"), "platform");
    expect(first).toMatchObject({ decisions: 3, replaced: 1, commit: null });
    await writeFile(join(root, "e.md"), DECISIONS.replace("PRJ-1", "ENG-1"));
    await importDecisions(repo, join(root, "e.md"), "engine");
    await importDecisions(repo, join(root, "d.md"), "platform");
    const file = await readDecisions(repo);
    expect(file.decisions.map((d) => `${d.group}:${d.id}`).sort()).toEqual(["engine:ENG-1", "engine:ENG-7", "engine:SID-3", "platform:ENG-7", "platform:PRJ-1", "platform:SID-3"]);
    await writeFile(join(root, "bad.md"), DECISIONS.replace("| PRJ-1 |", "|PRJ-1|"));
    await expect(importDecisions(repo, join(root, "bad.md"), "platform")).rejects.toThrow(/does not render back as it is/);
    await writeFile(join(root, "none.md"), "# nothing\n");
    await expect(importDecisions(repo, join(root, "none.md"), "x")).rejects.toThrow(/holds no decision rows/);
  });
});

describe("questions", () => {
  test("parse the open rows and the next row, and import them as records the status then reads", async () => {
    const parsed = parseQuestions(QUESTIONS, "engine");
    expect(parsed.open.map((q) => q.row)).toEqual([36, 37]);
    expect(parsed.nextRow).toBe(38);
    const { repo, root } = await makeTracked();
    expect(await openQuestions(repo)).toEqual({ rows: [], nextRow: null });
    await writeFile(join(root, "q.md"), QUESTIONS);
    expect(await importQuestions(repo, join(root, "q.md"), "engine")).toMatchObject({ open: 2, nextRow: 38 });
    expect(await openQuestions(repo)).toEqual({ rows: ["36 (engine)", "37 (engine)"], nextRow: 38 });
  });

  test("add takes the next row under the lock, answer moves a row to the answered list", async () => {
    const { repo, root } = await makeTracked();
    await writeFile(join(root, "q.md"), QUESTIONS);
    await importQuestions(repo, join(root, "q.md"), "engine");
    const [a, b] = await Promise.all([addQuestion(repo, { group: "data", question: "a?", meanwhile: "refuse" }), addQuestion(repo, { group: "data", question: "b?", meanwhile: "refuse" })]);
    expect([a.question.row, b.question.row].sort()).toEqual([38, 39]);
    const answered = await answerQuestion(repo, 36, "SIM-8");
    expect(answered.question.row).toBe(36);
    const file = (await readQuestions(repo))!;
    expect(file.open.map((q) => q.row)).toEqual([37, 38, 39]);
    expect(file.answered[0]).toMatchObject({ row: 36, decision: "SIM-8" });
    expect(file.nextRow).toBe(40);
    await expect(answerQuestion(repo, 36, "x")).rejects.toThrow("no open question 36; open: 37, 38, 39");
  });

  test("takes the rows answered before the record existed, sorted, and never a row it holds", async () => {
    const { repo } = await makeTracked();
    await addQuestion(repo, { group: "engine", question: "Open?", meanwhile: "Wait." });
    const open = (await readQuestions(repo))!.open[0]!.row;
    const old = (row: number) => ({ row, group: "platform", question: `Row ${row}?`, meanwhile: "", answeredAt: "2026-10-29", decision: `PRJ-${row}` });

    const done = await importAnswered(repo, [old(open + 3), old(open + 2)]);

    const file = (await readQuestions(repo))!;
    expect(done.answered).toBe(2);
    expect(file.answered.map((q) => q.row)).toEqual([open + 2, open + 3]);
    expect(file.nextRow).toBe(open + 4);
    await expect(importAnswered(repo, [old(open)])).rejects.toThrow(`row ${open} is already`);
    await expect(importAnswered(repo, [old(open + 2)])).rejects.toThrow(`row ${open + 2} is already`);
    await expect(importAnswered(repo, [old(open + 9), old(open + 9)])).rejects.toThrow(`row ${open + 9} is already`);
    expect((await readQuestions(repo))!.answered).toHaveLength(2);
  });
});
