import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { addPhase } from "../../src/phases/add.ts";
import { listPhases } from "../../src/phases/list.ts";
import { closePhase } from "../../src/phases/close.ts";
import { OPERATOR } from "../support/context.ts";
import { commitOn } from "../support/landing.ts";
import { landedIn, milestoneIn, phased, queued } from "../support/phased.ts";
import { sh } from "../support/repo.ts";

const NOW = new Date("2026-11-14T09:00:00.000Z");
const GOAL = "Exports leave the product in two formats.";
const withG = async () => {
  const made = await phased();
  await addPhase(made.repo, OPERATOR, { id: "G", name: "exports", goal: GOAL, weight: 3, decision: "DEC-12" }, NOW);
  return { ...made, repo: await made.fresh() };
};

describe("listing the phases", () => {
  test("answers each stage and phase with its goal, decision, state and how many of its tasks are landed", async () => {
    const { repo } = await withG();
    await milestoneIn(repo, "G", "G1", "data", ["1 csv", "2 json"]);
    await landedIn(repo, "G1");

    const phases = await listPhases(repo, {});

    expect(phases.map((phase) => phase.id)).toEqual(["B", "G"]);
    expect(phases[1]).toEqual({ id: "G", name: "exports", goal: GOAL, decision: "DEC-12", state: "open", tasks: { total: 2, landed: 2 }, left: [] });
    expect(phases[0]).toMatchObject({ id: "B", name: "widen", state: "open", tasks: { total: 4, landed: 1 } });
    expect(phases[0]?.left[0]).toContain("3 of its tasks are not landed");
  });

  test("its `left` is exactly what closing would refuse on, and is empty when it would succeed", async () => {
    const { repo, root } = await withG();
    await milestoneIn(repo, "G", "G1", "data", ["1 csv", "2 json"]);
    const ticket = await queued(repo, "data");

    const planned = (await listPhases(repo, {}))[1];
    await landedIn(repo, "G1");
    const queuedOnly = (await listPhases(repo, {}))[1];
    await commitOn(root, "src/x.rs", "feat: x");
    const unrecorded = (await listPhases(repo, {}))[1];

    expect(planned?.left).toEqual(["2 of its tasks are not landed (G1 / 1 csv, G1 / 2 json); land them, or remove a planned one with task_remove", `track data has a landing in the queue (ticket ${ticket}); wait for it with land_wait, or cancel it with land_cancel`]);
    expect(queuedOnly?.left).toEqual([`track data has a landing in the queue (ticket ${ticket}); wait for it with land_wait, or cancel it with land_cancel`]);
    expect(unrecorded?.left[0]).toMatch(/^main has 1 commit the ledger does not record \([0-9a-f]{7}\); record each with task_land or task_other$/);
  });

  test("names a gap in one of the phase's milestones, and not a gap in another phase's", async () => {
    const { repo } = await withG();
    await milestoneIn(repo, "G", "G1", "data", []);
    await landedIn(repo, "G1");
    const { Records } = await import("../../src/store/records.ts");
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => (milestone.id === "G1" ? { ...milestone, delivers: [{ id: "csv", what: "the csv export" }] } : milestone)) }, message: "owes" }));

    const [, g] = await listPhases(repo, {});
    const [b] = await listPhases(repo, {});

    expect(g?.left).toHaveLength(1);
    expect(g?.left[0]).toContain("csv");
    expect(b?.left.join(" ")).not.toContain("csv");
  });

  test("keeps at most ten sentences in `left`", async () => {
    const { repo } = await withG();
    const { Records } = await import("../../src/store/records.ts");
    await milestoneIn(repo, "G", "G1", "data", ["1 csv"]);
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => (milestone.id === "G1" ? { ...milestone, delivers: Array.from({ length: 14 }, (_, index) => ({ id: `d${index}`, what: `deliverable ${index}` })) } : milestone)) }, message: "owes" }));

    expect((await listPhases(repo, {}))[1]?.left).toHaveLength(10);
  });

  test("writes nothing", async () => {
    const { repo, root } = await withG();
    await milestoneIn(repo, "G", "G1", "data", ["1 csv"]);
    const before = { status: await sh(root, ["status", "--porcelain", "-uall"]), phases: await readFile(join(root, "docs/records/phases.json"), "utf8"), ledger: await readFile(join(root, "docs/records/ledger.json"), "utf8") };

    await listPhases(repo, {});

    expect({ status: await sh(root, ["status", "--porcelain", "-uall"]), phases: await readFile(join(root, "docs/records/phases.json"), "utf8"), ledger: await readFile(join(root, "docs/records/ledger.json"), "utf8") }).toEqual(before);
  });

  test("filters by state, and shows when a closed phase closed and what it said", async () => {
    const { repo } = await withG();
    await milestoneIn(repo, "G", "G1", "data", ["1 csv"]);
    await landedIn(repo, "G1");
    await closePhase(repo, OPERATOR, { phase: "G", summary: "both formats ship" }, NOW);

    const closed = await listPhases(repo, { state: "closed" });
    const open = await listPhases(repo, { state: "open" });

    expect(closed).toEqual([{ id: "G", name: "exports", goal: GOAL, decision: "DEC-12", state: "closed", closedAt: NOW.toISOString(), summary: "both formats ship", tasks: { total: 1, landed: 1 }, left: [] }]);
    expect(open.map((phase) => phase.id)).toEqual(["B"]);
  });
});
