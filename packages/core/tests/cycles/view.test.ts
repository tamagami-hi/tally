import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { cycleDir, readCycles } from "../../src/cycles/file.ts";
import { cycleView } from "../../src/cycles/view.ts";
import { logActivity } from "../../src/records/activity.ts";
import { commitRecords } from "../../src/records/commit.ts";
import { addDecision } from "../../src/records/decisions.ts";
import { postNote } from "../../src/records/notes.ts";
import { openSession } from "../../src/state/sessions.ts";
import { Records, reopenRepo, type Repo } from "../../src/store/records.ts";
import { makeTracked } from "../support/tracked.ts";

const CLOSED = { n: 1, name: "the first", from: "abc1234", to: "def5678", closedAt: "2026-11-20T10:00:00.000Z", closedBy: { track: "main", agent: "operator" }, said: "close it", summary: "the store is built" };

async function withClosedCycle(): Promise<{ repo: Repo; root: string }> {
  const { repo, root } = await makeTracked();
  const folder = cycleDir(repo.recordsDir, 1);
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "ledger.json"), JSON.stringify({ schema: 1, baseline: "abc1234", other: [], milestones: [{ id: "A1", stage: "B", name: "reader", track: "data", weight: 1, tasks: [{ id: "1 read", track: "data", status: "landed", commit: "def5678", also: [] }] }] }));
  await writeFile(join(folder, "tracks.json"), JSON.stringify({ schema: 1, tracks: [] }));
  await writeFile(join(repo.recordsDir, "cycles.json"), JSON.stringify({ schema: 1, current: 2, cycles: [CLOSED] }));
  return { repo, root };
}

describe("a repository's cycles", () => {
  test("a repository with no cycles.json is in cycle 1 and has closed none", async () => {
    const { repo } = await makeTracked();

    expect(await readCycles(repo.recordsDir)).toEqual({ schema: 1, current: 1, cycles: [] });
  });

  test("a closed cycle is read through a view of its folder, with the base config", async () => {
    const { repo } = await withClosedCycle();

    const view = await cycleView(repo, 1);

    expect(view.recordsDir).toBe(cycleDir(repo.recordsDir, 1));
    expect(view.cycle).toBe(1);
    expect((await new Records(view).readLedger()).milestones.map((one) => one.id)).toEqual(["A1"]);
    expect(view.config.tracks.map((track) => track.name)).toEqual(["data", "engine"]);
    expect((await reopenRepo(view)).recordsDir).toBe(view.recordsDir);
  });

  test("refuses the current cycle's number and a number that is no closed cycle", async () => {
    const { repo } = await withClosedCycle();

    await expect(cycleView(repo, 2)).rejects.toThrow("cycle 2 is the current cycle: leave `cycle` out to read the current cycle");
    await expect(cycleView(repo, 7)).rejects.toThrow("no closed cycle 7; the closed cycles are 1");
  });

  test("is never written: every writing function refuses a view", async () => {
    const { repo, root } = await withClosedCycle();
    const view = await cycleView(repo, 1);
    const operator = await openSession(repo, { worktree: root, agent: "operator" });
    const readOnly = "cycle 1 is closed, and a closed cycle is read only";

    await expect(new Records(view).update((ledger) => ({ ledger, message: "x" }))).rejects.toThrow(readOnly);
    await expect(logActivity(view, { session: "s", track: "main", agent: "a", verb: "x" })).rejects.toThrow(readOnly);
    await expect(postNote(view, operator, { to: "all", kind: "heads-up", text: "x" })).rejects.toThrow(readOnly);
    await expect(addDecision(view, { id: "D-1", group: "g", text: "t", since: "s", status: "in force" }, { operator: true })).rejects.toThrow(readOnly);
    await expect(commitRecords(view, "x")).rejects.toThrow(readOnly);
  });
});
