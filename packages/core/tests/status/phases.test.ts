import { describe, expect, test } from "vitest";
import { addPhase } from "../../src/phases/add.ts";
import { closePhase } from "../../src/phases/close.ts";
import { collect } from "../../src/status/collect.ts";
import { Records } from "../../src/store/records.ts";
import { OPERATOR } from "../support/context.ts";
import { landedIn, milestoneIn, phased } from "../support/phased.ts";

const NOW = new Date("2026-11-14T12:00:00.000Z");

describe("the board's stages, which are phases", () => {
  test("carry a phase's goal and state, and when it closed", async () => {
    const made = await phased();
    await addPhase(made.repo, OPERATOR, { id: "G", name: "exports", goal: "Ship exports.", weight: 3 }, NOW);
    const repo = await made.fresh();
    await milestoneIn(repo, "G", "G1", "data", ["1 csv"]);
    await landedIn(repo, "G1");
    const open = await collect(repo, await new Records(repo).readLedger());
    await closePhase(repo, OPERATOR, { phase: "G", summary: "done" }, NOW);

    const closed = await collect(await made.fresh(), await new Records(repo).readLedger());

    expect(open.stages).toEqual([{ id: "B", name: "widen", state: "open" }, { id: "G", name: "exports", goal: "Ship exports.", state: "open" }]);
    expect(closed.stages[1]).toEqual({ id: "G", name: "exports", goal: "Ship exports.", state: "closed", closedAt: NOW.toISOString() });
  });
});
