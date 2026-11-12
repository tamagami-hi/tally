import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { putEntry, retireEntry } from "../../src/context/entries.ts";
import { contextPack } from "../../src/context/pack.ts";
import { setProject } from "../../src/context/project.ts";
import { addQuestion } from "../../src/records/questions.ts";
import { OPERATOR, keepingContextAsRecords } from "../support/context.ts";
import { makeTracked } from "../support/tracked.ts";

const QUESTIONS = "# Questions\n\nRows are numbered; the next is 9.\n\n| # | question | meanwhile |\n| --- | --- | --- |\n| 8 | **Lots.** | refused |\n";

describe("the project pack of a repository that keeps its context as records", () => {
  test("is built from the project record and the rules in force, and reads no Markdown file", async () => {
    const tracked = await makeTracked();
    const repo = keepingContextAsRecords(tracked.repo);
    await writeFile(join(tracked.root, "CLAUDE.md"), "# Standing\n\nRead the rules.\n");
    await mkdir(join(tracked.root, "docs", "platform"), { recursive: true });
    await writeFile(join(tracked.root, "docs", "platform", "questions.md"), QUESTIONS);
    await setProject(repo, OPERATOR, { purpose: "Replay market data.", stack: ["rust", "typescript"], layout: [{ path: "crates/core", what: "the library" }], glossary: [{ term: "bar", means: "one interval's prices" }] });
    await putEntry(repo, OPERATOR, { kind: "rule", title: "Never push main", text: "Pushing is the operator's." });
    await putEntry(repo, OPERATOR, { kind: "rule", title: "Old rule", text: "No longer." });
    await retireEntry(repo, OPERATOR, "rule-2", "lifted");

    const pack = await contextPack(repo, { level: "project" });

    expect(pack.text).toBe([
      "# Test: project context",
      "",
      "Tracks: data (.temp/worktrees/data, track/data); engine (.temp/worktrees/engine, track/engine).",
      "Milestones: B2 1/4.",
      "Open questions: none; next row 1.",
      "Sessions: none. Locks held: none.",
      "",
      "## Project",
      "",
      "Replay market data.",
      "",
      "Stack: rust, typescript.",
      "",
      "Layout:",
      "- crates/core: the library",
      "",
      "Glossary:",
      "- bar: one interval's prices",
      "",
      "## Rules",
      "",
      "### rule-1. Never push main",
      "",
      "Pushing is the operator's.",
    ].join("\n"));
    expect(Object.keys(pack.parts)).toEqual(["name", "mainBranch", "tracks", "stages", "locks", "milestones", "openQuestions", "nextQuestionRow", "sessions", "claims", "heldLocks", "project", "rules"]);
    expect(pack.parts["project"]).toMatchObject({ purpose: "Replay market data.", stack: ["rust", "typescript"] });
    expect(pack.parts["rules"]).toMatchObject([{ id: "rule-1", title: "Never push main" }]);
  });

  test("says so when the project has no purpose and no rule yet, and counts the questions kept as records", async () => {
    const repo = keepingContextAsRecords((await makeTracked()).repo);
    await addQuestion(repo, { group: "platform", question: "Lots?", meanwhile: "refused" });

    const pack = await contextPack(repo, { level: "project" });

    expect(pack.text).toContain("Open questions: 1 (platform); next row 2.");
    expect(pack.text).toContain("## Project\n\n(no purpose yet: an operator session sets it with project_set)\n\n## Rules\n\n(no rule yet: an operator session adds one with context_put)");
    expect(pack.text).not.toContain("RULES.md");
    expect(pack.text).not.toContain("Keep it simple");
  });
});
