import { describe, expect, test } from "vitest";
import { addPhase } from "../../src/phases/add.ts";
import { closePhase } from "../../src/phases/close.ts";
import { assertMilestoneOpen, assertStageOpen } from "../../src/phases/open.ts";
import { Records } from "../../src/store/records.ts";
import { OPERATOR } from "../support/context.ts";
import { landedIn, milestoneIn, phased } from "../support/phased.ts";

const NOW = new Date("2026-11-14T09:00:00.000Z");

async function closed() {
  const made = await phased();
  await addPhase(made.repo, OPERATOR, { id: "G", name: "exports", goal: "Ship exports.", weight: 3 }, NOW);
  const repo = await made.fresh();
  await milestoneIn(repo, "G", "G1", "data", ["1 csv"]);
  await landedIn(repo, "G1");
  await closePhase(repo, OPERATOR, { phase: "G", summary: "done" }, NOW);
  return { ...made, repo: await made.fresh() };
}

describe("a closed phase", () => {
  test("refuses a new milestone in its stage, and a new task in one of its milestones", async () => {
    const { repo } = await closed();
    const ledger = await new Records(repo).readLedger();

    await expect(assertStageOpen(repo, "G")).rejects.toThrow("phase G is closed; later work goes in a new phase (phase_add)");
    await expect(assertMilestoneOpen(repo, ledger, "G1")).rejects.toThrow("phase G is closed; later work goes in a new phase (phase_add)");
  });

  test("leaves an open phase's stage and milestones alone, and a milestone the ledger does not have", async () => {
    const { repo } = await closed();
    const ledger = await new Records(repo).readLedger();

    await expect(assertStageOpen(repo, "B")).resolves.toBeUndefined();
    await expect(assertMilestoneOpen(repo, ledger, "B2")).resolves.toBeUndefined();
    await expect(assertMilestoneOpen(repo, ledger, "Z9")).resolves.toBeUndefined();
  });
});
