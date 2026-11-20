import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { Records, reopenRepo } from "../../src/store/records.ts";
import { openSession } from "../../src/state/sessions.ts";
import { landOrder } from "../../src/tracks/land-order.ts";
import { openTrack } from "../../src/tracks/open.ts";
import { commitOn } from "../support/landing.ts";
import { makeTracked } from "../support/tracked.ts";

async function ahead() {
  const tracked = await makeTracked();
  const operator = await openSession(tracked.repo, { worktree: tracked.root, agent: "operator" });
  for (const name of ["ui", "api"]) await openTrack(await reopenRepo(tracked.repo), operator, { name, purpose: `the ${name}` });
  const repo = await reopenRepo(tracked.repo);
  await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((milestone) => ({ ...milestone, tasks: milestone.tasks.map(({ waits: _waits, ...task }) => (task.id === "T9 store" ? { ...task, waitsOn: [{ task: "B2:4 manifest", what: "the manifest" }] } : task)) })) }, message: "waits" }));
  const tree = (name: string): string => join(tracked.root, ".temp/worktrees", name);
  await commitOn(tree("data"), "src/a.rs", "feat: a");
  await commitOn(tree("data"), "src/b.rs", "feat: b");
  await commitOn(tree("engine"), "src/a.rs", "feat: engine's a", "y\n");
  await commitOn(tree("ui"), "web/x.tsx", "feat: x");
  return repo;
}

describe("an order for landings", () => {
  test("answers each open track ahead of main with its files and the tracks it overlaps, and leaves out one that is not ahead", async () => {
    const repo = await ahead();

    const order = await landOrder(repo);

    expect(order.ahead).toEqual([
      { name: "data", commits: 2, files: ["src/a.rs", "src/b.rs"], overlaps: ["engine"] },
      { name: "engine", commits: 1, files: ["src/a.rs"], overlaps: ["data"] },
      { name: "ui", commits: 1, files: ["web/x.tsx"], overlaps: [] },
    ]);
  });

  test("suggests what others wait on first, then a track no other overlaps, then the overlapping ones, smallest first, each with a reason", async () => {
    const repo = await ahead();

    const order = await landOrder(repo);

    expect(order.suggestion).toBe(true);
    expect(order.landOrder).toEqual([
      { track: "data", reason: "others wait on it: B2 'T9 store'" },
      { track: "ui", reason: "it overlaps no other track ahead of main" },
      { track: "engine", reason: "it overlaps data; 1 changed file" },
    ]);
  });
});
