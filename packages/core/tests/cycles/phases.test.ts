import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { cycleDir } from "../../src/cycles/file.ts";
import { addPhase } from "../../src/phases/add.ts";
import { phaseRows } from "../../src/phases/rows.ts";
import { Records, reopenRepo } from "../../src/store/records.ts";
import { AT, cycling } from "../support/cycling.ts";
import { CLOSE_INPUT } from "../support/pending.ts";
import { sh } from "../support/repo.ts";

interface Phase {
  id: string;
  closedAt?: string;
  summary?: string;
}

const phasesIn = async (dir: string): Promise<Phase[]> => (JSON.parse(await readFile(join(dir, "phases.json"), "utf8")) as { phases: Phase[] }).phases;

async function withAddedPhase() {
  const made = await cycling();
  await addPhase(made.repo, made.operator, { id: "D", name: "read more", goal: "a second reader", weight: 1 }, AT);
  await writeFile(join(made.root, "b.txt"), "b\n");
  await sh(made.root, ["add", "b.txt"]);
  await sh(made.root, ["commit", "-q", "-m", "feat: b"]);
  const commit = await sh(made.root, ["rev-parse", "--short=7", "HEAD"]);
  const repo = await reopenRepo(made.repo);
  await new Records(repo).update((ledger) => ({
    ledger: { ...ledger, milestones: [...ledger.milestones, { id: "A3", stage: "D", name: "second reader", track: "data", weight: 1, tasks: [{ id: "3 read", track: "data", status: "landed" as const, commit, also: [] }] }] },
    message: "planned",
  }));
  return { ...made, repo };
}

describe("phases at a cycle's close", () => {
  test("the cycle's folder holds the phases closed before it or by it, and no open one", async () => {
    const { repo, operator } = await withAddedPhase();

    await closeCycle(repo, operator, CLOSE_INPUT, AT);

    const archived = await phasesIn(cycleDir(repo.recordsDir, 1));
    expect(archived.map((phase) => phase.id).sort()).toEqual(["B", "D"]);
    expect(archived.every((phase) => phase.closedAt === AT.toISOString() && phase.summary === "closed with cycle 1")).toBe(true);
  });

  test("a stage the config lists stays closed in the current folder, an added phase leaves with its cycle, and an open one stays", async () => {
    const { repo, operator, fresh } = await withAddedPhase();

    await closeCycle(repo, operator, CLOSE_INPUT, AT);

    expect((await phasesIn(repo.recordsDir)).map((phase) => phase.id).sort()).toEqual(["B", "C"]);
    const rows = await phaseRows(await fresh());
    expect(rows.map((row) => [row.id, row.closedAt ?? "open"])).toEqual([["B", AT.toISOString()], ["C", "open"]]);
  });
});
