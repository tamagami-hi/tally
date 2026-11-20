import { describe, expect, test } from "vitest";
import { closeCycle } from "../../src/cycles/close.ts";
import { cycleList, cycleOne, isComplete } from "../../src/cycles/list.ts";
import { Records } from "../../src/store/records.ts";
import { makeTracked } from "../support/tracked.ts";
import { AT, cycling } from "../support/cycling.ts";

const SAID = "close the first cycle";

describe("cycle_list without a number", () => {
  test("answers cycle 1 and no closed cycle for a repository that never closed one", async () => {
    const { repo } = await makeTracked();

    const listed = await cycleList(repo, {});

    expect(listed.current).toMatchObject({ n: 1, complete: false });
    expect(listed.closed).toEqual([]);
    expect(listed.matched).toBe(0);
  });

  test("answers the current cycle complete, with the sentence that asks, when nothing stops a close", async () => {
    const { repo } = await cycling();

    const listed = await cycleList(repo, {});

    expect(listed.current).toEqual({ n: 1, milestones: { open: 1, finished: 1, carried: 1 }, tasks: { landed: 1, total: 2 }, complete: true, blockers: [], ask: "everything planned in cycle 1 has landed: ask the operator whether to close it; cycle_close takes their words in `said`" });
    expect(await isComplete(repo, await new Records(repo).readLedger(), 1)).toBe(true);
  });

  test("names every blocker, and no sentence, while one stops the close", async () => {
    const { repo } = await cycling();
    await new Records(repo).update((ledger) => ({ ledger: { ...ledger, milestones: ledger.milestones.map((one) => (one.id !== "A1" ? one : { ...one, tasks: [...one.tasks, { id: "3 more", track: "data", status: "planned" as const, also: [] }] })) }, message: "more" }));

    const listed = await cycleList(repo, {});

    expect(listed.current.complete).toBe(false);
    expect(listed.current.blockers).toEqual([expect.stringContaining("A1 has landed work and is not finished"), "no milestone of cycle 1 is finished yet"]);
    expect(listed.current).not.toHaveProperty("ask");
  });

  test("lists the closed cycles newest first, with the counts read from each one's ledger", async () => {
    const { repo, operator } = await cycling();
    await closeCycle(repo, operator, { summary: "the reader is built", said: SAID, name: "the reader" }, AT);

    const listed = await cycleList(repo, {});

    expect(listed.current).toMatchObject({ n: 2, since: AT.toISOString(), milestones: { open: 1, finished: 0, carried: 1 }, complete: false });
    expect(listed.closed).toEqual([expect.objectContaining({ n: 1, name: "the reader", closedAt: AT.toISOString(), closedBy: { track: "main", agent: "operator" }, summary: "the reader is built", milestones: 1, tasks: 1 })]);
    expect(listed.matched).toBe(1);
  });
});

describe("cycle_list with a number", () => {
  test("answers that closed cycle whole, with its totals and its parked parts", async () => {
    const { repo, operator } = await cycling();
    await closeCycle(repo, operator, { summary: "the reader is built", said: SAID }, AT);

    const one = await cycleOne(repo, 1);

    expect(one).toMatchObject({ n: 1, said: SAID, summary: "the reader is built", totals: { phases: 2, milestones: 1, tasks: 1, tracks: 1, runs: 1, reviews: 1, notes: 2, days: 1 }, parked: [{ task: "A1:1 read", what: "the XML", why: "no client reads it" }] });
  });

  test("refuses the current cycle and one that never was", async () => {
    const { repo } = await cycling();

    await expect(cycleOne(repo, 1)).rejects.toThrow("cycle 1 is the current cycle: leave `cycle` out to read the current cycle");
    await expect(cycleOne(repo, 4)).rejects.toThrow("no closed cycle 4; the closed cycles are none");
  });
});
