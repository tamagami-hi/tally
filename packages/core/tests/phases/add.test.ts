import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { addMilestone } from "../../src/ledger/ops.ts";
import { addPhase } from "../../src/phases/add.ts";
import { Records } from "../../src/store/records.ts";
import { DATA, OPERATOR } from "../support/context.ts";
import { phased } from "../support/phased.ts";
import { sh } from "../support/repo.ts";

const NOW = new Date("2026-11-14T09:00:00.000Z");
const input = { id: "G", name: "exports", goal: "Exports leave the product in two formats.", weight: 3 };

describe("adding a phase", () => {
  test("stores the phase whole in phases.json, with who opened it and when", async () => {
    const { repo, root } = await phased();

    const { phase } = await addPhase(repo, OPERATOR, { ...input, decision: "DEC-12" }, NOW);

    expect(phase).toEqual({ id: "G", name: "exports", goal: input.goal, weight: 3, decision: "DEC-12", openedAt: NOW.toISOString(), openedBy: OPERATOR });
    expect(JSON.parse(await readFile(join(root, "docs/records/phases.json"), "utf8"))).toEqual({ schema: 1, phases: [phase] });
  });

  test("joins the repository's stages when it is opened again, so a milestone can name it", async () => {
    const { repo, fresh } = await phased();
    await addPhase(repo, OPERATOR, input, NOW);

    const reopened = await fresh();

    expect(reopened.config.stages).toEqual([{ id: "B", name: "widen", weight: 1 }, { id: "G", name: "exports", weight: 3 }]);
    const records = new Records(reopened);
    await expect(records.update((ledger) => addMilestone(ledger, { id: "G1", stage: "G", name: "csv", track: "data", weight: 1 }, reopened.config.stages.map((stage) => stage.id)))).resolves.toBeDefined();
  });

  test("refuses an id that is a stage or a phase already, and names the phases", async () => {
    const { repo } = await phased();
    await addPhase(repo, OPERATOR, input, NOW);

    await expect(addPhase(repo, OPERATOR, input, NOW)).rejects.toThrow("phase G exists; the phases are B and G");
    await expect(addPhase(repo, OPERATOR, { ...input, id: "B" }, NOW)).rejects.toThrow("phase B exists; the phases are B and G");
  });

  test("lists three phases as A, B and C", async () => {
    const { repo } = await phased();
    await addPhase(repo, OPERATOR, { ...input, id: "C" }, NOW);
    await addPhase(repo, OPERATOR, { ...input, id: "D" }, NOW);

    await expect(addPhase(repo, OPERATOR, { ...input, id: "D" }, NOW)).rejects.toThrow("the phases are B, C and D");
  });

  test("is for an operator session, and a track that wants a phase asks a question", async () => {
    const { repo, root } = await phased();

    await expect(addPhase(repo, DATA, input, NOW)).rejects.toThrow("only an operator session adds a phase; a track that wants one asks a question with question_add");
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });

  test.each([
    [{ id: "" }, /id/],
    [{ id: "-G" }, /id/],
    [{ id: "G H" }, /id/],
    [{ id: "G".repeat(41) }, /id/],
    [{ name: "" }, /name/],
    [{ name: "n".repeat(81) }, /name/],
    [{ goal: " " }, /goal/],
    [{ goal: "g".repeat(501) }, /goal/],
    [{ weight: 0 }, /weight/],
    [{ weight: 1.5 }, /weight/],
    [{ decision: "d".repeat(201) }, /decision/],
  ])("refuses %j with the field named", async (bad, field) => {
    const { repo, root } = await phased();

    await expect(addPhase(repo, OPERATOR, { ...input, ...bad }, NOW)).rejects.toThrow(field);
    expect(await sh(root, ["status", "--porcelain"])).toBe("");
  });

  test("takes the longest id, a digit first, and an underscore and a dash", async () => {
    const { repo } = await phased();

    for (const id of ["9", "a_b-c", `A${"b".repeat(39)}`]) await expect(addPhase(repo, OPERATOR, { ...input, id }, NOW)).resolves.toBeDefined();
  });

  test("commits at once in the each mode, and waits on disk in the phase mode", async () => {
    const each = await phased({ commit: true });
    const waiting = await phased();
    const before = await each.count();
    const beforeWaiting = await waiting.count();

    const first = await addPhase(each.repo, OPERATOR, input, NOW);
    const second = await addPhase(waiting.repo, OPERATOR, input, NOW);

    expect(first.commit).toMatch(/^[0-9a-f]{7}$/);
    expect(second.commit).toBeNull();
    expect(await each.count()).toBe(before + 1);
    expect(await waiting.count()).toBe(beforeWaiting);
  });
});
