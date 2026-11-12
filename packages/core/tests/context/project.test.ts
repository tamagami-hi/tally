import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { readProject, setProject } from "../../src/context/project.ts";
import { sh } from "../support/repo.ts";
import { makeTracked } from "../support/tracked.ts";

const DATA = { track: "data", agent: "claude" };
const OPERATOR = { track: "main", agent: "operator" };
const NINE = new Date("2026-11-12T09:00:00Z");
const TEN = new Date("2026-11-12T10:00:00Z");

describe("the project record", () => {
  test("reads as empty before it is written", async () => {
    const { repo } = await makeTracked();

    expect(await readProject(repo)).toEqual({ schema: 1, purpose: "", stack: [], layout: [], glossary: [] });
  });

  test("set merges the given fields, keeps the others, and says who set it and when", async () => {
    const { repo, root } = await makeTracked();
    await setProject(repo, OPERATOR, { purpose: "replay market data", stack: ["rust"], layout: [{ path: "crates/core", what: "the library" }] }, NINE);

    const { project } = await setProject(repo, OPERATOR, { stack: ["rust", "typescript"], glossary: [{ term: "bar", means: "one interval's prices" }] }, TEN);

    expect(project).toEqual({
      schema: 1,
      purpose: "replay market data",
      stack: ["rust", "typescript"],
      layout: [{ path: "crates/core", what: "the library" }],
      glossary: [{ term: "bar", means: "one interval's prices" }],
      updated: { at: "2026-11-12T10:00:00.000Z", by: OPERATOR },
    });
    expect(JSON.parse(await readFile(join(root, "docs/records/context/project.json"), "utf8"))).toEqual(project);
    expect(await readProject(repo)).toEqual(project);
  });

  test("is written only at operator scope, and a call that gives nothing is refused", async () => {
    const { repo } = await makeTracked();

    await expect(setProject(repo, DATA, { purpose: "x" })).rejects.toThrow("only an operator session writes the project record; a track that wants a change asks a question with question_add");
    await expect(setProject(repo, OPERATOR, {})).rejects.toThrow("the project record needs at least one of purpose, stack, layout and glossary");
    expect(await readProject(repo)).toMatchObject({ purpose: "" });
  });

  test("is a records commit where the config commits", async () => {
    const { repo, root } = await makeTracked({ commit: true });

    const { commit } = await setProject(repo, OPERATOR, { purpose: "replay market data" }, NINE);

    expect(commit).toMatch(/^[0-9a-f]{7}$/);
    expect(await sh(root, ["log", "-1", "--format=%s"])).toBe("records: the project record set by operator");
  });
});
